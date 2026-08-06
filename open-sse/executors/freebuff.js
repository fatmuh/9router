// Freebuff (Codebuff) custom executor.
//
// The upstream API at www.codebuff.com is OpenAI-compatible at
// /api/v1/chat/completions but requires three extra layers:
//
// 1. Agent Run: POST /api/v1/agent-runs {action:"START", agentId} → runId.
//    Each model maps to a "free agent" (e.g. base2-free, base2-free-mimo).
//    The runId ties chat requests to a server-side agent session.
//
// 2. Free Session: POST /api/v1/freebuff/session {} → {status, instanceId, ...}.
//    Tracks rate limiting / queueing. When status="queued", we poll until "active".
//    When 404 → sessions disabled (free tier not required).
//
// 3. Metadata injection: chat body gets metadata.run_id, metadata.cost_mode="free",
//    metadata.client_id, metadata.freebuff_instance_id injected before sending upstream.
//
// Error handling: session/run invalidation triggers one retry with fresh run+session.

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";

const BASE_URL = "https://www.codebuff.com";
const CHAT_PATH = "/api/v1/chat/completions";
const AGENT_RUNS_PATH = "/api/v1/agent-runs";
const SESSION_PATH = "/api/v1/freebuff/session";

// Map upstream model → Codebuff free agent ID
const MODEL_AGENT_MAP = {
  "minimax/minimax-m2.7": "base2-free",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "mimo/mimo-v2.5": "base2-free-mimo",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "mimo/mimo-v2.5-pro": "base2-free-mimo-pro",
  "moonshotai/kimi-k2.6": "base2-free-kimi",
};

const DEFAULT_AGENT_ID = "base2-free";

// Session poll interval (clamped between 1s and 5s)
const SESSION_POLL_MIN_MS = 1000;
const SESSION_POLL_MAX_MS = 5000;
const SESSION_QUEUE_TIMEOUT_MS = 120_000; // give up after 2 min in queue

// Per-token in-memory state: { runs: Map<agentId, {runId, startedAt}>, session: {...}, clientId }
const tokenState = new Map();

function getState(token) {
  if (!tokenState.has(token)) {
    tokenState.set(token, {
      runs: new Map(),
      session: null,
      clientId: generateClientId(),
    });
  }
  return tokenState.get(token);
}

function invalidateSession(token) {
  const st = getState(token);
  st.session = null;
}

function invalidateRun(token, agentId) {
  const st = getState(token);
  st.runs.delete(agentId);
}

function generateClientId() {
  return "cl_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

function getAgentId(model) {
  return MODEL_AGENT_MAP[model] || DEFAULT_AGENT_ID;
}

// ── Agent Run management ─────────────────────────────────────────────────

async function ensureRun(token, agentId, proxyOptions) {
  const st = getState(token);
  const existing = st.runs.get(agentId);
  if (existing && Date.now() - existing.startedAt < 30 * 60 * 1000) {
    return existing.runId; // reuse for up to 30 min
  }

  dbg("FREEBUFF", `Starting agent run: ${agentId}`);
  const resp = await proxyAwareFetch(
    `${BASE_URL}${AGENT_RUNS_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Freebuff-CLI/0.0.96",
      },
      body: JSON.stringify({ action: "START", agentId }),
    },
    proxyOptions
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw Object.assign(new Error(`Freebuff start-run failed: ${resp.status} ${text}`), {
      status: resp.status,
    });
  }

  const data = await resp.json();
  if (!data.runId) {
    throw new Error(`Freebuff start-run missing runId: ${JSON.stringify(data)}`);
  }

  st.runs.set(agentId, { runId: data.runId, startedAt: Date.now() });
  dbg("FREEBUFF", `Agent run started: ${agentId} → ${data.runId}`);
  return data.runId;
}

// ── Free Session management ──────────────────────────────────────────────

async function ensureSession(token, proxyOptions) {
  const st = getState(token);

  // Cached active session
  if (
    st.session?.status === "active" &&
    st.session.instanceId &&
    Date.now() < st.session.expiresAt
  ) {
    return st.session.instanceId;
  }

  // Disabled sessions (404) — upstream doesn't require sessions for this token
  if (st.session?.status === "disabled") {
    return "";
  }

  return await refreshSession(token, proxyOptions);
}

async function refreshSession(token, proxyOptions) {
  const st = getState(token);

  const resp = await proxyAwareFetch(
    `${BASE_URL}${SESSION_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Freebuff-CLI/0.0.96",
      },
      body: JSON.stringify({}),
    },
    proxyOptions
  );

  if (resp.status === 404) {
    st.session = { status: "disabled", instanceId: "", expiresAt: 0 };
    dbg("FREEBUFF", "Sessions disabled (404) — skipping session management");
    return "";
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw Object.assign(new Error(`Freebuff session create failed: ${resp.status} ${text}`), {
      status: resp.status,
    });
  }

  const data = await resp.json();
  if (!data.status) {
    throw new Error(`Freebuff session response missing status: ${JSON.stringify(data)}`);
  }

  // Handle queue
  if (data.status === "queued") {
    return await pollQueuedSession(token, data, proxyOptions);
  }

  if (data.status === "active") {
    st.session = {
      status: "active",
      instanceId: data.instanceId || "",
      expiresAt: data.expiresAt
        ? new Date(data.expiresAt).getTime() - 5000 // 5s safety buffer
        : Date.now() + 3600_000,
    };
    dbg("FREEBUFF", `Session active: instanceId=${data.instanceId?.slice(0, 12)}...`);
    return st.session.instanceId;
  }

  // ended / superseded / none / disabled — retry create
  if (["ended", "superseded", "none"].includes(data.status)) {
    dbg("FREEBUFF", `Session status=${data.status}, retrying create...`);
    // Just set a placeholder and return — the create above already happened
    st.session = { status: data.status, instanceId: data.instanceId || "", expiresAt: 0 };
    // Don't recurse — let the next request retry
    return data.instanceId || "";
  }

  throw new Error(`Freebuff session unexpected status: ${data.status}`);
}

async function pollQueuedSession(token, initialData, proxyOptions) {
  const st = getState(token);
  const queueStart = Date.now();

  let data = initialData;
  let pollDelay = SESSION_POLL_MIN_MS;

  while (data.status === "queued") {
    if (Date.now() - queueStart > SESSION_QUEUE_TIMEOUT_MS) {
      throw Object.assign(
        new Error(
          `Freebuff session queue timeout after ${SESSION_QUEUE_TIMEOUT_MS / 1000}s (position ${data.position}/${data.queueDepth})`
        ),
        { status: 503 }
      );
    }

    dbg(
      "FREEBUFF",
      `Session queued: position ${data.position}/${data.queueDepth}, waiting ${pollDelay}ms...`
    );
    await new Promise((r) => setTimeout(r, pollDelay));

    // Poll with GET + instance header
    const resp = await proxyAwareFetch(
      `${BASE_URL}${SESSION_PATH}`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "User-Agent": "Freebuff-CLI/0.0.96",
          "x-freebuff-instance-id": data.instanceId || "",
        },
      },
      proxyOptions
    );

    if (!resp.ok) {
      if (resp.status === 404) {
        st.session = { status: "disabled", instanceId: "", expiresAt: 0 };
        return "";
      }
      const text = await resp.text().catch(() => "");
      throw Object.assign(
        new Error(`Freebuff session poll failed: ${resp.status} ${text}`),
        { status: resp.status }
      );
    }

    data = await resp.json();

    // Adaptive poll delay from estimated wait
    if (data.estimatedWaitMs > 0) {
      pollDelay = Math.min(
        SESSION_POLL_MAX_MS,
        Math.max(SESSION_POLL_MIN_MS, data.estimatedWaitMs)
      );
    }
  }

  if (data.status === "active") {
    st.session = {
      status: "active",
      instanceId: data.instanceId || "",
      expiresAt: data.expiresAt
        ? new Date(data.expiresAt).getTime() - 5000
        : Date.now() + 3600_000,
    };
    dbg("FREEBUFF", `Session active after queue: instanceId=${data.instanceId?.slice(0, 12)}...`);
    return st.session.instanceId;
  }

  throw new Error(`Freebuff session unexpected status after queue: ${data.status}`);
}

// ── Chat completions with metadata injection ────────────────────────────

function injectMetadata(body, runId, instanceId, clientId) {
  const metadata = body.metadata || {};
  metadata.run_id = runId;
  metadata.cost_mode = "free";
  metadata.client_id = clientId;
  metadata.freebuff_instance_id = instanceId;
  return { ...body, metadata };
}

// Error patterns that indicate session/run needs refresh (from Go proxy)
const SESSION_INVALID_ERRORS = [
  "freebuff_update_required",
  "waiting_room_required",
  "waiting_room_queued",
  "session_superseded",
  "session_expired",
];

const RUN_INVALID_ERRORS = ["runid not found", "runid not running"];

function classifyError(status, bodyText) {
  const lower = (bodyText || "").toLowerCase();
  if (SESSION_INVALID_ERRORS.some((e) => lower.includes(e))) return "session";
  if (RUN_INVALID_ERRORS.some((e) => lower.includes(e))) return "run";
  return null;
}

// ── Executor class ───────────────────────────────────────────────────────

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS["freebuff"]);
  }

  buildUrl() {
    return `${BASE_URL}${CHAT_PATH}`;
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials?.accessToken;
    return {
      "Content-Type": "application/json",
      "Accept": stream ? "text/event-stream" : "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "Freebuff-CLI/0.0.96",
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.apiKey || credentials?.accessToken;
    if (!token) {
      throw Object.assign(new Error("Freebuff: missing apiKey/accessToken"), { status: 401 });
    }

    const upstreamModel = body.model || model;
    const agentId = getAgentId(upstreamModel);
    const st = getState(token);

    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;
      let runId, instanceId;

      try {
        runId = await ensureRun(token, agentId, proxyOptions);
        instanceId = await ensureSession(token, proxyOptions);
      } catch (err) {
        // Session/run setup failed
        if (err.status === 401) throw err; // bad token, don't retry
        if (attempt < maxAttempts) {
          dbg("FREEBUFF", `Setup failed (attempt ${attempt}): ${err.message}, retrying...`);
          invalidateRun(token, agentId);
          invalidateSession(token);
          continue;
        }
        throw err;
      }

      const transformedBody = injectMetadata(body, runId, instanceId, st.clientId);
      const url = this.buildUrl();
      const headers = this.buildHeaders(credentials, stream);
      const bodyStr = JSON.stringify(transformedBody);

      dbg("FREEBUFF", `→ ${url} | model=${upstreamModel} agent=${agentId} run=${runId?.slice(0, 8)}... body=${bodyStr.length}B`);

      const response = await proxyAwareFetch(
        url,
        {
          method: "POST",
          headers,
          body: bodyStr,
          signal,
        },
        proxyOptions
      );

      // Success — return to base handler for SSE/JSON processing
      if (response.status >= 200 && response.status < 300) {
        return { response, url, headers, transformedBody };
      }

      // 401 — token invalid
      if (response.status === 401) {
        const errText = await response.text().catch(() => "");
        throw Object.assign(new Error(`Freebuff 401: ${errText}`), { status: 401 });
      }

      // Check if error is session/run related → retry with fresh state
      if (attempt < maxAttempts) {
        const errText = await response.text().catch(() => "");
        const errType = classifyError(response.status, errText);
        if (errType) {
          dbg("FREEBUFF", `${errType} error (attempt ${attempt}): ${errText.slice(0, 200)}, retrying...`);
          if (errType === "session") invalidateSession(token);
          if (errType === "run") invalidateRun(token, agentId);
          continue;
        }
        // Non-retryable error — return as-is for error handling
        return { response, url, headers, transformedBody };
      }

      // Last attempt — return error response as-is
      return { response, url, headers, transformedBody };
    }

    throw new Error("Freebuff: max attempts exhausted");
  }
}
