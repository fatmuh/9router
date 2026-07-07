// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 1;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  roles: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      description: "TEXT",
      permissions: "TEXT NOT NULL",   // JSON array of permission keys
      isSystem: "INTEGER DEFAULT 0",  // system roles (admin) can't be deleted
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
  },
  users: {
    columns: {
      id: "TEXT PRIMARY KEY",
      username: "TEXT UNIQUE NOT NULL",
      passwordHash: "TEXT",          // bcrypt; null for pure OIDC users
      roleId: "TEXT NOT NULL",
      isActive: "INTEGER DEFAULT 1",
      oidcSubject: "TEXT",           // links to OIDC identity (optional)
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
      lastLoginAt: "TEXT",
      // ── Per-user token quota (account-level, all keys combined) ──
      limitTokens: "INTEGER",       // max tokens per window; null = no limit
      limitWindowMs: "INTEGER",     // window duration in ms; null/0 = no limit
      windowStartedAt: "TEXT",      // ISO datetime; anchor of current rolling window
      allowedModels: "TEXT",        // JSON array of model ids/globs; null/empty = all models (account-wide)
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_users_role ON users(roleId)",
      "CREATE INDEX IF NOT EXISTS idx_users_oidc ON users(oidcSubject)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // ── Scoping fields (additive; auto-added by syncSchemaFromTables) ──
      allowedModels: "TEXT",      // JSON array of model ids/globs; null/empty = all models
      expiresAt: "TEXT",          // ISO datetime; null = never expires
      note: "TEXT",               // free-form description
      lastUsedAt: "TEXT",         // ISO datetime; auto-updated on each use
      // ── RBAC: which user owns this key (null = claimed by first admin on migration) ──
      userId: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_user ON apiKeys(userId)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      userId: "TEXT",               // RBAC: which user made the request (for per-user quota)
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  apifyKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      token: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      usageCount: "INTEGER DEFAULT 0",
      lastUsedAt: "TEXT",
      lastError: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_token ON apifyKeys(token)",
      "CREATE INDEX IF NOT EXISTS idx_ak_active ON apifyKeys(isActive)",
    ],
  },
  auditLog: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      actorUserId: "TEXT",
      actorUsername: "TEXT",
      action: "TEXT NOT NULL",
      targetType: "TEXT",
      targetId: "TEXT",
      ip: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_al_ts ON auditLog(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_al_actor ON auditLog(actorUserId)",
      "CREATE INDEX IF NOT EXISTS idx_al_action ON auditLog(action)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
