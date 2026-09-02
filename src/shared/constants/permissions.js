// Permission catalog — the fixed set of capabilities an admin can grant to a role.
// Grouped for UI rendering. Each key is checked via hasPermission(session, "group.cap").

export const PERMISSION_CATALOG = [
  {
    group: "system",
    label: "System",
    permissions: [
      { key: "users.manage", label: "Manage users", desc: "Create/edit/delete users, reset passwords" },
      { key: "roles.manage", label: "Manage roles", desc: "Create/edit roles and their permissions" },
      { key: "settings.manage", label: "Manage settings", desc: "Auth mode, observability, server settings" },
      { key: "tunnel.manage", label: "Manage tunnel", desc: "Cloudflare / Tailscale tunnel lifecycle" },
    ],
  },
  {
    group: "providers",
    label: "Providers & Models",
    permissions: [
      { key: "providers.view", label: "View providers", desc: "See provider connections & their models" },
      { key: "providers.manage", label: "Manage providers", desc: "Add/edit/delete/test provider connections" },
      { key: "providers.nodes", label: "Manage nodes", desc: "Compatible provider nodes" },
      { key: "models.view", label: "View models", desc: "See model aliases & custom models" },
      { key: "models.manage", label: "Manage models", desc: "Aliases, custom models, disabled models" },
      { key: "combos.manage", label: "Manage combos", desc: "Create/edit model combos" },
      { key: "pricing.manage", label: "Manage pricing", desc: "Edit provider pricing data" },
    ],
  },
  {
    group: "keys",
    label: "API Keys",
    permissions: [
      { key: "keys.own", label: "Manage own keys", desc: "Create/view/scope personal API keys" },
      { key: "keys.view.all", label: "View all keys", desc: "See every user's API keys" },
    ],
  },
  {
    group: "usage",
    label: "Usage & Logs",
    permissions: [
      { key: "usage.view", label: "View usage", desc: "See usage across all users" },
      { key: "quota.view.own", label: "View own token quota", desc: "See your personal token quota status" },
      { key: "quota.tracker", label: "Quota tracker", desc: "Provider rate-limit / quota tracking page" },
      { key: "logs.view", label: "View logs", desc: "Console log & request details" },
    ],
  },
  {
    group: "tools",
    label: "Tools & Media",
    permissions: [
      { key: "media.view", label: "View media providers", desc: "See TTS/STT/embedding/web providers" },
      { key: "media.manage", label: "Manage media", desc: "Configure TTS/STT/media provider connections" },
      { key: "cli.tools", label: "CLI tools", desc: "Manage CLI tool configs" },
      { key: "mitm.manage", label: "Manage MITM", desc: "MITM tooling" },
      { key: "translator.view", label: "Translator", desc: "Translator playground" },
      { key: "mcp.manage", label: "Manage MCP", desc: "MCP marketplace & config" },
      { key: "chat.basic", label: "Basic chat", desc: "Use basic-chat playground" },
    ],
  },
];

// Flat list of all permission keys.
export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

// The admin system role has every permission.
export const ADMIN_PERMISSIONS = [...ALL_PERMISSIONS];

// Quick lookup: permission -> label/desc
export const PERMISSION_META = Object.fromEntries(
  PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => [p.key, p]))
);
