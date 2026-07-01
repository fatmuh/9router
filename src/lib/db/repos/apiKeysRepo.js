import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { resolveWindow, formatWindowMs } from "@/lib/auth/apiKeyScope.js";

// Normalize a raw DB row into an API key object, parsing JSON scope fields.
function rowToKey(row) {
  if (!row) return null;
  let allowedModels = null;
  if (row.allowedModels) {
    try { allowedModels = JSON.parse(row.allowedModels); } catch { allowedModels = null; }
    if (!Array.isArray(allowedModels)) allowedModels = null;
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    // Scope fields (may be absent on rows from legacy inserts)
    allowedModels: allowedModels || [],
    expiresAt: row.expiresAt || null,
    note: row.note || null,
    lastUsedAt: row.lastUsedAt || null,
    userId: row.userId || null,
  };
}

export async function getApiKeys(userId = null) {
  const db = await getAdapter();
  const rows = userId
    ? db.all(`SELECT * FROM apiKeys WHERE userId = ? OR userId IS NULL ORDER BY createdAt ASC`, [userId])
    : db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Fetch full key record by raw key string (used by enforcement layer).
export async function getApiKeyByKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

// Sanitize scope payload coming from API/UI into safe DB values.
function sanitizeScope(scope = {}) {
  const out = {};
  if (scope.allowedModels !== undefined) {
    const arr = Array.isArray(scope.allowedModels)
      ? scope.allowedModels
      : (typeof scope.allowedModels === "string" ? scope.allowedModels.split(/[\n,]/) : []);
    out.allowedModels = JSON.stringify(
      arr.map((s) => String(s).trim()).filter(Boolean)
    );
  }
  if (scope.expiresAt !== undefined) {
    const v = scope.expiresAt;
    out.expiresAt = v ? String(v) : null;
  }
  if (scope.note !== undefined) {
    out.note = scope.note ? String(scope.note) : null;
  }
  return out;
}

/**
 * Create a new API key.
 * @param {string} name
 * @param {string} machineId
 * @param {object} [scope] - { allowedModels[], expiresAt, note, userId }
 */
export async function createApiKey(name, machineId, scope = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    key: result.key,
    name,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  const sc = sanitizeScope(scope);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels, expiresAt, note, userId)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt,
      sc.allowedModels ?? null, sc.expiresAt ?? null, sc.note ?? null, scope.userId ?? null,
    ]
  );
  return {
    ...apiKey,
    allowedModels: scope.allowedModels || [],
    expiresAt: sc.expiresAt ?? null,
    note: sc.note ?? null,
    lastUsedAt: null,
    userId: scope.userId ?? null,
  };
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const sc = sanitizeScope(data);
    const allowedModels = sc.allowedModels ?? JSON.stringify(merged.allowedModels || []);
    const expiresAt = data.expiresAt !== undefined ? (sc.expiresAt ?? null) : (merged.expiresAt ?? null);
    const note = data.note !== undefined ? (sc.note ?? null) : (merged.note ?? null);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, expiresAt = ?, note = ?, lastUsedAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, allowedModels, expiresAt, note, merged.lastUsedAt ?? null, id]
    );
    result = { ...merged, allowedModels: merged.allowedModels || [], expiresAt, note };
  });
  return result;
}

// Assign all unowned (legacy) keys to a user — used during RBAC migration so old keys
// aren't orphaned. The first admin claims them.
export async function claimLegacyKeys(userId) {
  if (!userId) return 0;
  const db = await getAdapter();
  const res = db.run(`UPDATE apiKeys SET userId = ? WHERE userId IS NULL`, [userId]);
  return res?.changes ?? 0;
}

// Stamp lastUsedAt on a key (called after a successful scope pass). Best-effort.
export async function touchApiKeyLastUsed(id) {
  if (!id) return;
  try {
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET lastUsedAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
  } catch { /* non-critical */ }
}

// (setApiKeyWindowStart removed — token quota window is now per-USER, see setUserWindowStart in usersRepo.js)

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Backward-compatible boolean validator (used by dashboardGuard).
export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (row.isActive !== 1 && row.isActive !== true) return false;
  // Honor expiry at the guard level too (cheap, no model context needed).
  if (row.expiresAt) {
    const exp = new Date(row.expiresAt).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) return false;
  }
  return true;
}

/**
 * Compute live per-USER token quota status (account-wide, all keys combined).
 * Returns [{ userId, username, limitTokens, usedTokens, remainingTokens, windowStart, resetAt, windowLabel, percentFull, isFull, isNearFull, notStarted }].
 * @param {string|null} userId - null = all users with a quota
 */
export async function getQuotaStatus(userId = null) {
  const { getUsers } = await import("./usersRepo.js");
  const { getTokenUsageByUserSince } = await import("./usageRepo.js");
  const all = await getUsers();
  const list = userId ? all.filter((u) => u.id === userId) : all;
  const now = Date.now();
  const out = [];
  for (const user of list) {
    // Include users WITHOUT a quota too (shown as "unlimited" in the UI).
    if (!user.limitTokens || !user.limitWindowMs) {
      out.push({
        userId: user.id,
        username: user.username,
        isUnlimited: true,
        limitTokens: null,
        usedTokens: 0,
        remainingTokens: null,
        windowStart: null,
        resetAt: null,
        windowLabel: null,
        percentFull: 0,
        isFull: false,
        isNearFull: false,
        notStarted: true,
      });
      continue;
    }
    const win = resolveWindow(user, now);
    let usedTokens = 0;
    if (win.windowStart) {
      usedTokens = await getTokenUsageByUserSince(user.id, new Date(win.windowStart).toISOString());
    }
    const pct = user.limitTokens > 0 ? Math.min(100, (usedTokens / user.limitTokens) * 100) : 0;
    out.push({
      userId: user.id,
      username: user.username,
      isUnlimited: false,
      limitTokens: user.limitTokens,
      usedTokens,
      remainingTokens: Math.max(0, user.limitTokens - usedTokens),
      windowStart: win.windowStart ? new Date(win.windowStart).toISOString() : null,
      resetAt: win.resetAt,
      windowLabel: formatWindowMs(user.limitWindowMs),
      percentFull: Math.round(pct),
      isFull: usedTokens >= user.limitTokens,
      isNearFull: pct >= 80 && usedTokens < user.limitTokens,
      notStarted: !win.windowStart || win.isNew,
    });
  }
  return out;
}
