"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Badge } from "@/shared/components";

// ── Quota progress bar (same pattern as ProviderLimits) ──
function QuotaProgressBar({ label, used, total, percentage, unlimited, unit }) {
  const colors =
    percentage > 70
      ? { text: "text-green-500", bg: "bg-green-500", bgLight: "bg-green-500/10", emoji: "🟢" }
      : percentage >= 30
      ? { text: "text-yellow-500", bg: "bg-yellow-500", bgLight: "bg-yellow-500/10", emoji: "🟡" }
      : { text: "text-red-500", bg: "bg-red-500", bgLight: "bg-red-500/10", emoji: "🔴" };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-primary">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{colors.emoji}</span>
          <span className={`font-medium ${colors.text}`}>
            {unlimited ? "∞" : `${Math.round(100 - percentage)}%`}
          </span>
        </div>
      </div>
      {!unlimited && (
        <div className={`h-2 rounded-full overflow-hidden ${colors.bgLight}`}>
          <div
            className={`h-full transition-all duration-300 ${colors.bg}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{used?.toLocaleString()} / {total?.toLocaleString()} {unit}</span>
      </div>
    </div>
  );
}

// ── Provider Limit Card (same pattern as ProviderLimits) ──
function AccountCard({ account, keys, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const plan = account?.plan || "free";
  const planVariants = { free: "default", platform: "default", pro: "primary", enterprise: "info" };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  // Compute quotas from account data
  const quotas = [];
  if (account?.usage) {
    const u = account.usage;
    const p = account.planUsage || {};

    // Requests
    if (u.totalRequests !== undefined) {
      quotas.push({
        label: "Total Requests",
        used: u.totalRequests,
        total: p.totalRequests || u.totalRequests || 0,
        unit: "requests",
      });
    }

    // Compute Units
    if (u.totalComputeUnits !== undefined) {
      quotas.push({
        label: "Compute Units",
        used: u.totalComputeUnits,
        total: p.totalComputeUnits || 0,
        unit: "CU",
      });
    }

    // Proxy Requests
    if (u.totalProxyRequests !== undefined) {
      quotas.push({
        label: "Proxy Requests",
        used: u.totalProxyRequests,
        total: p.totalProxyRequests || 0,
        unit: "requests",
      });
    }

    // Data Transfer
    if (u.totalDataTransferBytes !== undefined) {
      quotas.push({
        label: "Data Transfer",
        used: u.totalDataTransferBytes,
        total: p.totalDataTransferBytes || 0,
        unit: "bytes",
      });
    }

    // Actor Compute Units
    if (u.totalComputeUnitsSecs !== undefined) {
      quotas.push({
        label: "Actor Compute",
        used: u.totalComputeUnitsSecs,
        total: p.totalComputeUnitsSecs || 0,
        unit: "CU·s",
      });
    }

    // Storage
    if (u.totalStorageBytes !== undefined) {
      quotas.push({
        label: "Storage",
        used: u.totalStorageBytes,
        total: p.totalStorageBytes || 0,
        unit: "bytes",
      });
    }
  }

  return (
    <Card padding="md" className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg flex items-center justify-center bg-[#F38020]/15">
            <span className="material-symbols-outlined text-[20px]" style={{ color: "#F38020" }}>cloud</span>
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">
              {account?.name || account?.username || "Apify Account"}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              {account?.username && (
                <span className="text-xs text-text-muted">@{account.username}</span>
              )}
              <Badge variant={planVariants[plan] || "default"} size="sm">
                {plan}
              </Badge>
              {account?.proxyUnlimited && (
                <Badge variant="success" size="sm">Unlimited Proxy</Badge>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
          title="Refresh account info"
        >
          <span className={`material-symbols-outlined text-[20px] text-text-muted ${refreshing ? "animate-spin" : ""}`}>
            refresh
          </span>
        </button>
      </div>

      {/* Error */}
      {account?.error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-red-500 text-[20px]">error</span>
            <p className="text-sm text-red-600 dark:text-red-400">{account.error}</p>
          </div>
        </div>
      )}

      {/* Loading shimmer */}
      {account?.loading && (
        <div className="space-y-4">
          <div className="h-4 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
          <div className="h-2 bg-black/5 dark:bg-white/5 rounded animate-pulse" />
        </div>
      )}

      {/* Quota progress bars */}
      {!account?.error && !account?.loading && quotas.length > 0 && (
        <div className="space-y-4">
          {quotas.map((q) => {
            const pct = q.total > 0 ? ((q.total - q.used) / q.total) * 100 : q.used > 0 ? 100 : 0;
            const unlimited = q.total === 0 || q.total === null;
            return (
              <QuotaProgressBar
                key={q.label}
                label={q.label}
                used={q.used}
                total={q.total}
                percentage={pct}
                unlimited={unlimited}
                unit={q.unit}
              />
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!account?.error && !account?.loading && quotas.length === 0 && (
        <div className="text-center py-6 text-text-muted">
          <span className="material-symbols-outlined text-[48px] opacity-20">data_usage</span>
          <p className="text-sm mt-2">No usage data available</p>
        </div>
      )}

      {/* Keys list */}
      {keys.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="text-xs font-medium text-text-muted mb-2">Keys ({keys.length})</p>
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-text-muted">{k.tokenPreview}</span>
                  <Badge variant={k.isActive ? "success" : "error"} className="text-[9px]">
                    {k.isActive ? "Active" : "Off"}
                  </Badge>
                </div>
                <span className="text-text-muted">{k.usageCount || 0} req</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Main Page ──
export default function ApifyPage() {
  const [keys, setKeys] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [addName, setAddName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/keys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/account");
      const data = await res.json();
      setAccounts(data.accounts || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);
  useEffect(() => { if (keys.length > 0) fetchAccounts(); }, [keys, fetchAccounts]);

  // Auto-refresh (60s like quota page)
  useEffect(() => {
    if (!autoRefresh || keys.length === 0) return;
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchAccounts(); return 60; }
        return c - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [autoRefresh, keys.length, fetchAccounts]);

  const handleAdd = async () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/apify/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens: lines, name: addName || undefined }),
      });
      const data = await res.json();
      setResult(data);
      setBulkText("");
      setAddName("");
      fetchKeys();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key) => {
    if (!confirm(`Delete key "${key.name || key.id}"?`)) return;
    try { await fetch(`/api/apify/keys?id=${key.id}`, { method: "DELETE" }); fetchKeys(); } catch (e) { console.error(e); }
  };

  const handleToggle = async (key) => {
    try { await fetch("/api/apify/keys", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: key.id, isActive: !key.isActive }) }); fetchKeys(); } catch (e) { console.error(e); }
  };

  // Group keys by account username (or fallback to key.name)
  const accountMap = {};
  for (const a of accounts) { accountMap[a.id] = a; }

  // Build card list: one per key (with account info attached)
  const keyCards = keys.map((k) => ({
    key: k,
    account: accountMap[k.id] || null,
  }));

  // Summary stats
  const totalRequests = accounts.reduce((s, a) => s + (a.usage?.totalRequests || 0), 0);
  const totalCU = accounts.reduce((s, a) => s + (a.usage?.totalComputeUnits || 0), 0);
  const activeKeys = keys.filter((k) => k.isActive).length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apify Gateway</h1>
          <p className="text-sm text-text-muted mt-1">
            Multi-account proxy with round-robin key rotation
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-text-muted">
              Updated {lastUpdated.toLocaleTimeString()}
              {autoRefresh && ` • Next in ${countdown}s`}
            </span>
          )}
          <Button onClick={() => setAddMode(!addMode)} icon={addMode ? "close" : "add"}>
            {addMode ? "Cancel" : "Add Keys"}
          </Button>
        </div>
      </div>

      {/* Summary bar (like quota page top stats) */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{activeKeys}/{keys.length}</p>
            <p className="text-xs text-text-muted mt-1">Keys</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-500">{totalRequests.toLocaleString()}</p>
            <p className="text-xs text-text-muted mt-1">Total Requests</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-500">{totalCU.toLocaleString()}</p>
            <p className="text-xs text-text-muted mt-1">Compute Units</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-500">{accounts.length}</p>
            <p className="text-xs text-text-muted mt-1">Accounts</p>
          </div>
        </div>
      </Card>

      {/* Add Keys */}
      {addMode && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Add Apify API Keys</h3>
          <p className="text-xs text-text-muted mb-3">
            Paste one API key per line. Get yours at{" "}
            <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener" className="text-primary hover:underline">
              Console &gt; Settings &gt; Integrations
            </a>
          </p>
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Account name (optional)"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-input text-sm mb-2 focus:outline-none focus:border-primary"
          />
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"apify_api_xxxxx\napify_api_yyyyy\napify_api_zzzzz"}
            className="w-full font-mono text-xs rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-text-muted">
              {bulkText.split("\n").filter((l) => l.trim()).length} key(s) ready
            </span>
            <Button onClick={handleAdd} disabled={saving || !bulkText.trim()}>
              {saving ? "Adding..." : "Add All Keys"}
            </Button>
          </div>
          {result && (
            <div className={`mt-3 p-2 rounded text-sm ${result.error ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"}`}>
              {result.error ? result.error : `Added ${result.created || 0} key(s)`}
            </div>
          )}
        </Card>
      )}

      {/* API Usage Info */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">API Usage</h3>
        <p className="text-xs text-text-muted mb-2">
          Replace <code>api.apify.com</code> with this base URL:
        </p>
        <div className="bg-bg-subtle rounded-lg p-3 font-mono text-xs">
          <span className="text-primary">GET</span> /apify/v2/{"{actor_id}"}/run-sync-get-dataset-items
        </div>
        <p className="text-xs text-text-muted mt-2">
          All Apify v2 endpoints work 1:1. Keys are injected server-side.
        </p>
      </Card>

      {/* Account cards (ProviderLimitCard pattern) */}
      {loading ? (
        <Card className="p-8 text-center text-text-muted">Loading keys...</Card>
      ) : keyCards.length === 0 ? (
        <Card className="p-8 text-center text-text-muted">
          No API keys configured. Click &quot;Add Keys&quot; to get started.
        </Card>
      ) : (
        <div className="space-y-4">
          {keyCards.map(({ key, account }) => (
            <div key={key.id} className="flex flex-col gap-2">
              <AccountCard
                account={account ? { ...account, name: key.name, loading: false } : { name: key.name, loading: true }}
                keys={[key]}
                onRefresh={fetchAccounts}
              />
              <div className="flex items-center gap-2 px-1">
                <Button size="sm" variant="ghost" onClick={() => handleToggle(key)}>
                  {key.isActive ? "Disable" : "Enable"}
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(key)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
