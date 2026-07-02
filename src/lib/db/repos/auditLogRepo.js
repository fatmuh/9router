import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

/**
 * Append an audit-log entry. Fire-and-forget safe: never throws (logs a warning).
 * @param {{
 *   action: string,             // e.g. "user.login", "key.delete"
 *   actorUserId?: string|null,
 *   actorUsername?: string|null,
 *   targetType?: string|null,   // "user" | "role" | "apiKey" | "settings" | ...
 *   targetId?: string|null,
 *   ip?: string|null,
 *   meta?: object|null,
 * }} entry
 */
export async function logAudit(entry) {
  try {
    if (!entry || !entry.action) return;
    const db = await getAdapter();
    db.run(
      `INSERT INTO auditLog(id, timestamp, actorUserId, actorUsername, action, targetType, targetId, ip, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        new Date().toISOString(),
        entry.actorUserId || null,
        entry.actorUsername || null,
        entry.action,
        entry.targetType || null,
        entry.targetId || null,
        entry.ip || null,
        entry.meta ? stringifyJson(entry.meta) : null,
      ]
    );
  } catch (e) {
    // Audit logging must never break the request flow.
    console.warn("[audit] logAudit failed:", e?.message || e);
  }
}

/**
 * Read audit log with optional filters + pagination.
 * @returns {Promise<{ entries: Array, total: number }>}
 */
export async function getAuditLog(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (filter.actorUserId) { conds.push("actorUserId = ?"); params.push(filter.actorUserId); }
  if (filter.action) { conds.push("action = ?"); params.push(filter.action); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(filter.startDate); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(filter.endDate); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const totalRow = db.get(`SELECT COUNT(*) AS c FROM auditLog ${where}`, params);
  const total = totalRow ? totalRow.c : 0;

  const page = Math.max(1, Number(filter.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(filter.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT * FROM auditLog ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const entries = rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    actorUserId: r.actorUserId,
    actorUsername: r.actorUsername,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    ip: r.ip,
    meta: parseJson(r.meta, null),
  }));

  return { entries, total, page, pageSize };
}

/** Distinct action values (for the filter dropdown). */
export async function getAuditActions() {
  const db = await getAdapter();
  try {
    return db.all(`SELECT DISTINCT action FROM auditLog ORDER BY action ASC`).map((r) => r.action);
  } catch {
    return [];
  }
}
