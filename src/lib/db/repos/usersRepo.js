import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";
import { getRoleById } from "./rolesRepo.js";
import { stringifyJson } from "../helpers/jsonCol.js";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash || null,
    roleId: row.roleId,
    isActive: row.isActive === 1 || row.isActive === true,
    oidcSubject: row.oidcSubject || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt || null,
    limitTokens: row.limitTokens != null ? Number(row.limitTokens) : null,
    limitWindowMs: row.limitWindowMs != null ? Number(row.limitWindowMs) : null,
    windowStartedAt: row.windowStartedAt || null,
    allowedModels: (() => { try { const a = JSON.parse(row.allowedModels); return Array.isArray(a) ? a : null; } catch { return null; } })(),
  };
}

// Coerce a limit value to a positive integer or null.
function sanitizeLimit(v) {
  const n = v === null || v === "" ? null : Number(v);
  return n == null || Number.isNaN(n) || n <= 0 ? null : Math.floor(n);
}

export async function getUsers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM users ORDER BY createdAt ASC`).map(rowToUser);
}

export async function getUserById(id) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE id = ?`, [id]));
}

export async function getUserByUsername(username) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`, [username]));
}

export async function getUserByOidcSubject(subject) {
  const db = await getAdapter();
  return rowToUser(db.get(`SELECT * FROM users WHERE oidcSubject = ?`, [subject]));
}

export async function countUsers() {
  const db = await getAdapter();
  return db.get(`SELECT COUNT(*) AS c FROM users`)?.c ?? 0;
}

export async function countActiveAdmins() {
  const db = await getAdapter();
  return db.get(`SELECT COUNT(*) AS c FROM users WHERE roleId = 'role-admin' AND isActive = 1`)?.c ?? 0;
}

/**
 * Create a user. passwordHash is bcrypt-hashed from the plaintext password.
 * @param {{ username:string, password?:string, roleId:string, oidcSubject?:string, isActive?:boolean, limitTokens?:number, limitWindowMs?:number, allowedModels?:string[] }} data
 */
export async function createUser({ username, password, roleId, oidcSubject = null, isActive = true, limitTokens = null, limitWindowMs = null, allowedModels = null }) {
  if (!username) throw new Error("Username is required");
  if (!roleId) throw new Error("roleId is required");
  const db = await getAdapter();
  // Validate role exists.
  const role = await getRoleById(roleId);
  if (!role) throw new Error("Role not found");
  // Password required unless OIDC-linked.
  let passwordHash = null;
  if (password) {
    passwordHash = await bcrypt.hash(password, 10);
  } else if (!oidcSubject) {
    throw new Error("Password is required (unless OIDC-linked)");
  }
  const now = new Date().toISOString();
  const lt = sanitizeLimit(limitTokens);
  const lw = sanitizeLimit(limitWindowMs);
  const am = Array.isArray(allowedModels) ? (allowedModels.length ? stringifyJson(allowedModels) : null) : null;
  const user = { id: uuidv4(), username, passwordHash, roleId, isActive: isActive !== false, oidcSubject, limitTokens: lt, limitWindowMs: lw, allowedModels: am ? JSON.parse(am) : null, createdAt: now, updatedAt: now };
  db.run(
    `INSERT INTO users(id, username, passwordHash, roleId, isActive, oidcSubject, createdAt, updatedAt, lastLoginAt, limitTokens, limitWindowMs, windowStartedAt, allowedModels) VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
    [user.id, user.username, user.passwordHash, user.roleId, user.isActive ? 1 : 0, user.oidcSubject, now, now, lt, lw, am]
  );
  return user;
}

export async function updateUser(id, data) {
  const db = await getAdapter();
  const existing = rowToUser(db.get(`SELECT * FROM users WHERE id = ?`, [id]));
  if (!existing) return null;
  const now = new Date().toISOString();
  if (data.roleId) {
    const role = await getRoleById(data.roleId);
    if (!role) throw new Error("Role not found");
  }
  const merged = {
    username: data.username || existing.username,
    roleId: data.roleId || existing.roleId,
    isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
    oidcSubject: data.oidcSubject !== undefined ? data.oidcSubject : existing.oidcSubject,
    limitTokens: data.limitTokens !== undefined ? sanitizeLimit(data.limitTokens) : existing.limitTokens,
    limitWindowMs: data.limitWindowMs !== undefined ? sanitizeLimit(data.limitWindowMs) : existing.limitWindowMs,
    allowedModels: data.allowedModels !== undefined ? (Array.isArray(data.allowedModels) && data.allowedModels.length ? data.allowedModels : null) : existing.allowedModels,
  };
  const amJson = Array.isArray(merged.allowedModels) && merged.allowedModels.length ? stringifyJson(merged.allowedModels) : null;
  db.run(`UPDATE users SET username = ?, roleId = ?, isActive = ?, oidcSubject = ?, limitTokens = ?, limitWindowMs = ?, allowedModels = ?, updatedAt = ? WHERE id = ?`, [
    merged.username, merged.roleId, merged.isActive ? 1 : 0, merged.oidcSubject, merged.limitTokens, merged.limitWindowMs, amJson, now, id,
  ]);
  return { ...existing, ...merged };
}

// Set a new password (bcrypt). Null/empty clears it (OIDC-only).
export async function setUserPassword(id, password) {
  const db = await getAdapter();
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const now = new Date().toISOString();
  db.run(`UPDATE users SET passwordHash = ?, updatedAt = ? WHERE id = ?`, [hash, now, id]);
  return true;
}

export async function touchUserLogin(id) {
  const db = await getAdapter();
  db.run(`UPDATE users SET lastLoginAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
}

// Anchor the rolling window start for a user (resets the quota counter).
export async function setUserWindowStart(id, isoTimestamp) {
  if (!id) return;
  const db = await getAdapter();
  db.run(`UPDATE users SET windowStartedAt = ? WHERE id = ?`, [isoTimestamp, id]);
}

export async function deleteUser(id) {
  const db = await getAdapter();
  const user = rowToUser(db.get(`SELECT * FROM users WHERE id = ?`, [id]));
  if (!user) return false;
  // Prevent deleting / deactivating the last active admin.
  if (user.roleId === "role-admin" && user.isActive) {
    const remaining = await countActiveAdmins();
    if (remaining <= 1) throw new Error("Cannot delete the last active admin");
  }
  const res = db.run(`DELETE FROM users WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Verify plaintext password against a user's hash.
export async function verifyUserPassword(user, password) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}
