import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    name: row.name,
    isActive: row.isActive === 1 || row.isActive === true,
    usageCount: row.usageCount || 0,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getApifyKeys(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) {
    where.push("isActive = ?");
    params.push(filter.isActive ? 1 : 0);
  }
  const sql = `SELECT * FROM apifyKeys${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY createdAt DESC`;
  return db.all(sql, params).map(rowToKey);
}

export async function getApifyKeyById(id) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apifyKeys WHERE id = ?`, [id]));
}

export async function createApifyKey(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = data.id || uuidv4();
  db.run(
    `INSERT INTO apifyKeys(id, token, name, isActive, usageCount, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, data.token, data.name || null, data.isActive !== false ? 1 : 0, 0, now, now]
  );
  return rowToKey(db.get(`SELECT * FROM apifyKeys WHERE id = ?`, [id]));
}

export async function updateApifyKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apifyKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = rowToKey(row);
    if (data.name !== undefined) merged.name = data.name;
    if (data.isActive !== undefined) merged.isActive = data.isActive;
    if (data.token !== undefined) merged.token = data.token;
    if (data.lastError !== undefined) merged.lastError = data.lastError;
    const now = new Date().toISOString();
    db.run(
      `UPDATE apifyKeys SET token=?, name=?, isActive=?, lastError=?, updatedAt=? WHERE id=?`,
      [merged.token, merged.name, merged.isActive ? 1 : 0, merged.lastError, now, id]
    );
    result = { ...merged, updatedAt: now };
  });
  return result;
}

export async function deleteApifyKey(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apifyKeys WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToKey(row);
    db.run(`DELETE FROM apifyKeys WHERE id = ?`, [id]);
  });
  return removed;
}

export async function touchApifyKey(id) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `UPDATE apifyKeys SET usageCount = usageCount + 1, lastUsedAt = ?, updatedAt = ? WHERE id = ?`,
    [now, now, id]
  );
}

export async function markApifyKeyError(id, error) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `UPDATE apifyKeys SET lastError = ?, updatedAt = ? WHERE id = ?`,
    [error, now, id]
  );
}

export async function getActiveApifyKeys() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM apifyKeys WHERE isActive = 1 ORDER BY usageCount ASC, createdAt ASC`).map(rowToKey);
}
