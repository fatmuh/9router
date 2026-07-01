import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { ALL_PERMISSIONS, ADMIN_PERMISSIONS } from "@/shared/constants/permissions";

function rowToRole(row) {
  if (!row) return null;
  let perms = [];
  try { perms = JSON.parse(row.permissions); } catch { perms = []; }
  if (!Array.isArray(perms)) perms = [];
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    permissions: perms,
    isSystem: row.isSystem === 1 || row.isSystem === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRoles() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM roles ORDER BY isSystem DESC, name ASC`).map(rowToRole);
}

export async function getRoleById(id) {
  const db = await getAdapter();
  return rowToRole(db.get(`SELECT * FROM roles WHERE id = ?`, [id]));
}

export async function getRoleByName(name) {
  const db = await getAdapter();
  return rowToRole(db.get(`SELECT * FROM roles WHERE name = ?`, [name]));
}

// Ensure the built-in admin system role exists (idempotent, runs on every boot).
export async function ensureSystemAdminRole() {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const existing = db.get(`SELECT id FROM roles WHERE name = 'admin'`);
  if (existing) {
    // Re-sync: the system admin always holds EVERY permission (so newly added
    // permissions in the catalog are granted on the next boot — no lockout).
    db.run(`UPDATE roles SET permissions = ?, isSystem = 1, updatedAt = ? WHERE id = ?`, [
      JSON.stringify(ADMIN_PERMISSIONS), now, existing.id,
    ]);
    return existing.id;
  }
  const id = "role-admin";
  db.run(
    `INSERT INTO roles(id, name, description, permissions, isSystem, createdAt, updatedAt) VALUES(?, ?, ?, ?, 1, ?, ?)`,
    [id, "admin", "Full access (system)", JSON.stringify(ADMIN_PERMISSIONS), now, now]
  );
  return id;
}

export async function createRole({ name, description = "", permissions = [] }) {
  if (!name) throw new Error("Role name is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  // Filter to known permissions only.
  const valid = [...new Set(permissions.filter((p) => ALL_PERMISSIONS.includes(p)))];
  const role = { id: uuidv4(), name, description, permissions: valid, isSystem: false, createdAt: now, updatedAt: now };
  db.run(
    `INSERT INTO roles(id, name, description, permissions, isSystem, createdAt, updatedAt) VALUES(?, ?, ?, ?, 0, ?, ?)`,
    [role.id, role.name, role.description, JSON.stringify(role.permissions), now, now]
  );
  return role;
}

export async function updateRole(id, data) {
  const db = await getAdapter();
  const existing = rowToRole(db.get(`SELECT * FROM roles WHERE id = ?`, [id]));
  if (!existing) return null;
  if (existing.isSystem) {
    // System admin role: name/description editable, permissions always full.
    const now = new Date().toISOString();
    db.run(`UPDATE roles SET name = ?, description = ?, updatedAt = ? WHERE id = ?`, [
      data.name || existing.name, data.description ?? existing.description, now, id,
    ]);
    return { ...existing, name: data.name || existing.name, description: data.description ?? existing.description };
  }
  const merged = {
    name: data.name || existing.name,
    description: data.description ?? existing.description,
    permissions: data.permissions ? [...new Set(data.permissions.filter((p) => ALL_PERMISSIONS.includes(p)))] : existing.permissions,
  };
  const now = new Date().toISOString();
  db.run(`UPDATE roles SET name = ?, description = ?, permissions = ?, updatedAt = ? WHERE id = ?`, [
    merged.name, merged.description, JSON.stringify(merged.permissions), now, id,
  ]);
  return { ...existing, ...merged };
}

export async function deleteRole(id) {
  const db = await getAdapter();
  const role = rowToRole(db.get(`SELECT * FROM roles WHERE id = ?`, [id]));
  if (!role) return false;
  if (role.isSystem) throw new Error("System roles cannot be deleted");
  // Block deletion if any user still uses it.
  const count = db.get(`SELECT COUNT(*) AS c FROM users WHERE roleId = ?`, [id])?.c ?? 0;
  if (count > 0) throw new Error(`Role is assigned to ${count} user(s) — reassign them first`);
  const res = db.run(`DELETE FROM roles WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
