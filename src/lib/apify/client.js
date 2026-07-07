/**
 * Apify round-robin proxy client.
 * Fetches active keys from DB, round-robins across them, retries on failure.
 */

import { getActiveApifyKeys, touchApifyKey, markApifyKeyError } from "../db/repos/apifyKeysRepo.js";

const APIFY_BASE = "https://api.apify.com";

let rotationIndex = 0;

/**
 * Select next API key (round-robin).
 * Returns the key object with { id, token, name }.
 */
export async function selectKey() {
  const keys = await getActiveApifyKeys();
  if (!keys || keys.length === 0) {
    throw new Error("No active Apify API keys configured. Add keys in Dashboard > Apify.");
  }
  const key = keys[rotationIndex % keys.length];
  rotationIndex = (rotationIndex + 1) % keys.length;
  return key;
}

/**
 * Proxy a request to the Apify API.
 * @param {string} apifyPath - path after /v2/, e.g. "actors/abc123/runs"
 * @param {object} options - { method, body, headers, searchParams }
 * @param {number} [retryCount=0] - current retry attempt
 * @returns {Response} proxied response
 */
export async function proxyToApify(apifyPath, options = {}, retryCount = 0) {
  const MAX_RETRIES = 3;
  const key = await selectKey();

  const url = new URL(`${APIFY_BASE}/v2/${apifyPath}`);
  if (options.searchParams) {
    for (const [k, v] of Object.entries(options.searchParams)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      "Authorization": `Bearer ${key.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  if (options.body && fetchOptions.method !== "GET") {
    fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  try {
    const upstreamRes = await fetch(url.toString(), fetchOptions);
    await touchApifyKey(key.id).catch(() => {});

    // If rate-limited or server error, try next key
    if ((upstreamRes.status === 429 || upstreamRes.status >= 500) && retryCount < MAX_RETRIES) {
      await markApifyKeyError(key.id, `HTTP ${upstreamRes.status}`).catch(() => {});
      return proxyToApify(apifyPath, options, retryCount + 1);
    }

    // Forward response with CORS headers
    const headers = new Headers(upstreamRes.headers);
    headers.set("X-Apify-Key-Used", key.name || key.id.substring(0, 8));
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers,
    });
  } catch (err) {
    await markApifyKeyError(key.id, err.message).catch(() => {});
    if (retryCount < MAX_RETRIES) {
      return proxyToApify(apifyPath, options, retryCount + 1);
    }
    throw err;
  }
}

/**
 * Get status of all keys (for dashboard).
 */
export async function getKeyStatus() {
  const keys = await getActiveApifyKeys();
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    isActive: k.isActive,
    usageCount: k.usageCount,
    lastUsedAt: k.lastUsedAt,
    lastError: k.lastError,
    tokenPreview: k.token ? `${k.token.substring(0, 8)}...${k.token.substring(k.token.length - 4)}` : "",
  }));
}
