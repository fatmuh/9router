// Pure API-key scope evaluation logic (no DB / no I/O) — easy to unit test.
// Orchestrated enforcement (DB lookups) lives in enforceApiKeyAccess() below.

import { getApiKeyByKey, touchApiKeyLastUsed } from "@/lib/db/repos/apiKeysRepo.js";
import { getTokenUsageByUserSince } from "@/lib/db/repos/usageRepo.js";
import { getUserById, setUserWindowStart } from "@/lib/db/repos/usersRepo.js";

/**
 * Convert a glob pattern (supports `*` wildcard) into a RegExp.
 * Literal characters are escaped; `*` becomes `.*`.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  if (typeof pattern !== "string" || !pattern) return /.^/; // never-match
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Does `model` match any pattern in `allowedModels`?
 * Empty list → all models allowed.
 * @param {string} model
 * @param {string[]} allowedModels
 * @returns {boolean}
 */
export function isModelAllowed(model, allowedModels) {
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) return true;
  if (!model) return false;
  return allowedModels.some((p) => globToRegExp(p).test(model));
}

/**
 * Resolve the current rolling window for a key.
 * Returns { windowStart, resetAt, isNew }.
 *  - If the key has no limit → windowStart = null (no quota tracking).
 *  - If never used (windowStartedAt null) → a new window starts NOW.
 *  - If expired (now - windowStartedAt >= windowMs) → a new window starts NOW.
 *  - Otherwise → reuse existing windowStartedAt.
 *
 * @param {object} keyRecord - { limitTokens, limitWindowMs, windowStartedAt }
 * @param {number} [now] - epoch ms (injectable for tests)
 */
export function resolveWindow(keyRecord, now = Date.now()) {
  const limitTokens = Number(keyRecord?.limitTokens);
  const windowMs = Number(keyRecord?.limitWindowMs);
  const hasLimit = Number.isFinite(limitTokens) && limitTokens > 0 && Number.isFinite(windowMs) && windowMs > 0;
  if (!hasLimit) return { hasLimit: false, windowStart: null, resetAt: null, isNew: false };

  const existing = keyRecord?.windowStartedAt ? new Date(keyRecord.windowStartedAt).getTime() : null;
  if (existing != null && Number.isFinite(existing) && now - existing < windowMs) {
    return { hasLimit: true, windowStart: existing, resetAt: existing + windowMs, isNew: false };
  }
  // No window yet, or expired → (re)start now.
  return { hasLimit: true, windowStart: now, resetAt: now + windowMs, isNew: true };
}

/**
 * Pure scope check against a key record + request context.
 * Key-level only: active, expiry, model whitelist. (Token quota is user-level.)
 * @param {object} keyRecord - { isActive, expiresAt, allowedModels }
 * @param {object} ctx - { model }
 * @returns {{ ok: boolean, error?: string, code?: string }}
 */
export function checkApiKeyScope(keyRecord, ctx = {}) {
  if (!keyRecord) return { ok: false, error: "Invalid API key", code: "invalid" };

  if (keyRecord.isActive === false) {
    return { ok: false, error: "API key is paused", code: "paused" };
  }

  if (keyRecord.expiresAt) {
    const exp = new Date(keyRecord.expiresAt).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) {
      return { ok: false, error: "API key has expired", code: "expired" };
    }
  }

  if (!isModelAllowed(ctx.model, keyRecord.allowedModels)) {
    return {
      ok: false,
      error: `Model "${ctx.model}" is not allowed for this API key`,
      code: "model_not_allowed",
    };
  }

  return { ok: true };
}

/** Human-readable window duration (e.g. "5h", "2d", "30m"). */
export function formatWindowMs(ms) {
  if (!ms || ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Full orchestration: fetch key record, run KEY-level scope (active/expiry/model),
 * then resolve the OWNER user and run USER-level token quota.
 * @param {string|null} apiKey - raw key string
 * @param {{ model?: string }} ctx
 * @returns {Promise<{ok:true, keyId?:string, userId?:string}|{ok:false, error:string, code:string, statusCode:number, resetAt?:number}>}
 */
export async function enforceApiKeyAccess(apiKey, ctx = {}) {
  if (!apiKey) return { ok: true }; // local mode — no scoping
  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord) return { ok: false, error: "Invalid API key", code: "invalid", statusCode: 401 };

  // ── Key-level checks: active, expiry, model whitelist ──
  const keyScope = checkApiKeyScope({
    isActive: keyRecord.isActive,
    expiresAt: keyRecord.expiresAt,
    allowedModels: keyRecord.allowedModels,
  }, { model: ctx.model });
  if (!keyScope.ok) {
    const statusCode = keyScope.code === "invalid" || keyScope.code === "paused" || keyScope.code === "expired" ? 401 : 403;
    return { ok: false, error: keyScope.error, code: keyScope.code, statusCode };
  }

  // ── User-level: allowed models + token quota (account-wide, all keys combined) ──
  if (keyRecord.userId) {
    const user = await getUserById(keyRecord.userId);
    if (user) {
      // Allowed-models whitelist at the USER level (further restricts the key).
      if (Array.isArray(user.allowedModels) && user.allowedModels.length > 0) {
        if (!isModelAllowed(ctx.model, user.allowedModels)) {
          return {
            ok: false,
            error: `Model "${ctx.model}" is not allowed for this account`,
            code: "model_not_allowed",
            statusCode: 403,
          };
        }
      }

      // Token quota (rolling window, account-wide).
      const win = resolveWindow(user);
      if (win.hasLimit) {
        if (win.isNew) await setUserWindowStart(user.id, new Date(win.windowStart).toISOString());
        const tokensUsed = await getTokenUsageByUserSince(user.id, new Date(win.windowStart).toISOString());
        if (tokensUsed >= user.limitTokens) {
          return {
            ok: false,
            error: `Token quota (${user.limitTokens.toLocaleString()} tokens / ${formatWindowMs(user.limitWindowMs)}) reached for this account`,
            code: "quota_exceeded",
            statusCode: 429,
            resetAt: win.resetAt,
          };
        }
      }
    }
  }

  // Best-effort: stamp lastUsedAt (fire-and-forget).
  touchApiKeyLastUsed(keyRecord.id).catch(() => {});
  return { ok: true, keyId: keyRecord.id, userId: keyRecord.userId };
}

/**
 * Build a JSON error Response for a failed scope check, attaching
 * `X-Quota-Reset` (epoch seconds) + `Retry-After` when a quota window exists.
 * @param {{ statusCode:number, error:string, resetAt?:number }} scope
 * @param {{ buildErrorBody: (n,s)=>object }} [deps]
 */
export function scopeErrorResponse(scope, deps) {
  const body = deps?.buildErrorBody
    ? deps.buildErrorBody(scope.statusCode, scope.error)
    : { error: { message: scope.error, type: "invalid_request_error" } };
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (scope.resetAt) {
    const retryAfter = Math.max(0, Math.ceil((scope.resetAt - Date.now()) / 1000));
    headers["X-Quota-Reset"] = String(scope.resetAt);
    if (retryAfter > 0) headers["Retry-After"] = String(retryAfter);
  }
  return new Response(JSON.stringify(body), { status: scope.statusCode, headers });
}
