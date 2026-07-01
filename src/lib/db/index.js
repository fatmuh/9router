// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { makeBackupDir, backupFile, pruneOldBackups } from "./backup.js";
import { DATA_FILE } from "./paths.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByKey, createApiKey, updateApiKey, deleteApiKey, validateApiKey, touchApiKeyLastUsed, claimLegacyKeys, getQuotaStatus,
} from "./repos/apiKeysRepo.js";

// RBAC: roles & users
export {
  getRoles, getRoleById, getRoleByName, ensureSystemAdminRole, createRole, updateRole, deleteRole,
} from "./repos/rolesRepo.js";
export {
  getUsers, getUserById, getUserByUsername, getUserByOidcSubject, countUsers, countActiveAdmins, createUser, updateUser, setUserPassword, touchUserLogin, deleteUser, verifyUserPassword,
} from "./repos/usersRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  getRecentRequestsByUser, getUsageByUserSince,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    _format: "9router-db",
    _version: 2,
    _exportedAt: new Date().toISOString(),
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    roles: db.all(`SELECT * FROM roles`).map((r) => ({ id: r.id, name: r.name, description: r.description || null, permissions: parseJson(r.permissions, []), isSystem: r.isSystem === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    users: db.all(`SELECT * FROM users`).map((r) => ({ id: r.id, username: r.username, passwordHash: r.passwordHash || null, roleId: r.roleId, isActive: r.isActive === 1, oidcSubject: r.oidcSubject || null, createdAt: r.createdAt, updatedAt: r.updatedAt, lastLoginAt: r.lastLoginAt || null, limitTokens: r.limitTokens != null ? Number(r.limitTokens) : null, limitWindowMs: r.limitWindowMs != null ? Number(r.limitWindowMs) : null, windowStartedAt: r.windowStartedAt || null, allowedModels: parseJson(r.allowedModels, null) })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt, allowedModels: parseJson(r.allowedModels, []), expiresAt: r.expiresAt || null, note: r.note || null, lastUsedAt: r.lastUsedAt || null, userId: r.userId || null })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  // Usage data (for full backup / migration).
  out.usageHistory = db.all(`SELECT * FROM usageHistory`);
  out.usageDaily = db.all(`SELECT * FROM usageDaily`);
  out.requestDetails = db.all(`SELECT * FROM requestDetails`);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  // Sanity-check the shape before the destructive wipe: must look like a 9router export.
  const knownTables = ["settings", "providerConnections", "providerNodes", "users", "roles", "apiKeys", "combos"];
  const hasAny = knownTables.some((k) => Object.prototype.hasOwnProperty.call(payload, k));
  if (!hasAny) {
    throw new Error("Payload does not look like a 9router backup (no recognized tables)");
  }
  const db = await getAdapter();

  // Safety: snapshot the live DB file before a destructive restore.
  let backupPath = null;
  try {
    const bdir = makeBackupDir("pre-restore");
    backupPath = backupFile(DATA_FILE, bdir);
    pruneOldBackups();
  } catch (e) {
    console.warn("[DB][importDb] pre-restore snapshot failed:", e?.message || e);
  }

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM roles`);
    db.run(`DELETE FROM users`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM usageHistory`);
    db.run(`DELETE FROM usageDaily`);
    db.run(`DELETE FROM requestDetails`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    // Roles must be restored BEFORE users (users.roleId references them).
    for (const r of payload.roles || []) {
      db.run(
        `INSERT OR REPLACE INTO roles(id, name, description, permissions, isSystem, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.name, r.description || null, stringifyJson(r.permissions || []), r.isSystem ? 1 : 0, r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
      );
    }
    for (const u of payload.users || []) {
      db.run(
        `INSERT OR REPLACE INTO users(id, username, passwordHash, roleId, isActive, oidcSubject, createdAt, updatedAt, lastLoginAt, limitTokens, limitWindowMs, windowStartedAt, allowedModels) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [u.id, u.username, u.passwordHash || null, u.roleId, u.isActive === false ? 0 : 1, u.oidcSubject || null, u.createdAt || new Date().toISOString(), u.updatedAt || new Date().toISOString(), u.lastLoginAt || null, u.limitTokens != null ? Number(u.limitTokens) : null, u.limitWindowMs != null ? Number(u.limitWindowMs) : null, u.windowStartedAt || null, u.allowedModels ? stringifyJson(u.allowedModels) : null]
      );
    }
    for (const k of payload.apiKeys || []) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels, expiresAt, note, lastUsedAt, userId) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(), stringifyJson(k.allowedModels || []), k.expiresAt || null, k.note || null, k.lastUsedAt || null, k.userId || null]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    // Usage data (best-effort; columns are stable).
    for (const u of payload.usageHistory || []) {
      try {
        db.run(
          `INSERT OR REPLACE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, userId, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.id, u.timestamp, u.provider || null, u.model || null, u.connectionId || null, u.apiKey || null, u.userId || null, u.endpoint || null, Number(u.promptTokens) || 0, Number(u.completionTokens) || 0, Number(u.cost) || 0, u.status || null, u.tokens || null, u.meta || null]
        );
      } catch {}
    }
    for (const d of payload.usageDaily || []) {
      try { db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, d.data]); } catch {}
    }
    for (const r of payload.requestDetails || []) {
      try {
        db.run(
          `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [r.id, r.timestamp, r.provider || null, r.model || null, r.connectionId || null, r.status || null, r.data]
        );
      } catch {}
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
  });

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
