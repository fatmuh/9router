"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, SegmentedControl } from "@/shared/components";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

function useCountdown(resetAt) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return fmtTime(resetAt);
}

export default function FreebuffDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tab, setTab] = useState("accounts");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/freebuff");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData, autoRefresh]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="h-[88px] animate-pulse bg-bg-subtle" />
        ))}
      </div>
    );
  }
  if (!data) return <Card className="p-8 text-center text-text-muted">Failed to load Freebuff data. Is the proxy running?</Card>;

  const accounts = data.accounts || [];
  const summary = data.summary;

  // Aggregate stats
  const activeAccounts = accounts.filter(a => !a.paused && !a.banned && a.serve_status === "active").length;
  const idleAccounts = accounts.filter(a => !a.paused && !a.banned && a.account_status === "idle").length;
  const bannedAccounts = accounts.filter(a => a.banned).length;
  const pausedAccounts = accounts.filter(a => a.paused).length;
  const totalSessions = accounts.reduce((s, a) => s + (a.total_sessions || 0), 0);
  const totalRequests = accounts.reduce((s, a) => s + (a.local_usage?.requests || 0), 0);
  const totalTokensIn = accounts.reduce((s, a) => s + (a.local_usage?.tokens_in || 0), 0);
  const totalTokensOut = accounts.reduce((s, a) => s + (a.local_usage?.tokens_out || 0), 0);

  // Group by model
  const byModel = {};
  for (const a of accounts) {
    const m = a.session_model || "unknown";
    if (!byModel[m]) byModel[m] = { total: 0, active: 0, idle: 0, banned: 0, sessions: 0 };
    byModel[m].total++;
    if (a.banned) byModel[m].banned++;
    else if (a.paused) {} // skip
    else if (a.account_status === "active" || a.account_status === "streaming") byModel[m].active++;
    else byModel[m].idle++;
    byModel[m].sessions += a.total_sessions || 0;
  }

  const overviewCards = [
    { label: "Total Accounts", value: fmt(accounts.length), sub: `${activeAccounts} active · ${idleAccounts} idle`, cls: "text-text-main", icon: "group" },
    { label: "Active Sessions", value: fmt(totalSessions), sub: `${totalRequests} requests (30d)`, cls: "text-primary", icon: "bolt" },
    { label: "Input Tokens ↑", value: fmt(totalTokensIn), sub: "30d total", cls: "text-primary", icon: "arrow_upward" },
    { label: "Output Tokens ↓", value: fmt(totalTokensOut), sub: "30d total", cls: "text-success", icon: "arrow_downward" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold text-text-main">Freebuff Pool</span>
          {bannedAccounts > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 font-bold uppercase">{bannedAccounts} banned</span>
          )}
          {pausedAccounts > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-bold uppercase">{pausedAccounts} paused</span>
          )}
        </div>
        <SegmentedControl
          options={[
            { value: "on", label: "● Live" },
            { value: "off", label: "Paused" },
          ]}
          value={autoRefresh ? "on" : "off"}
          onChange={(v) => setAutoRefresh(v === "on")}
          size="sm"
          className="w-full sm:w-auto"
        />
      </div>

      {/* Overview cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
        {overviewCards.map((c) => (
          <Card key={c.label} className="flex min-w-0 flex-col gap-1 px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-text-muted">{c.icon}</span>
              <span className="text-text-muted text-sm uppercase font-semibold">{c.label}</span>
            </div>
            <span className={`truncate text-2xl font-bold tabular-nums ${c.cls}`}>{c.value}</span>
            {c.sub && <span className="text-[10px] text-text-muted">{c.sub}</span>}
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "accounts", label: "All Accounts" },
            { value: "models", label: "By Model" },
          ]}
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
        />
      </div>

      {tab === "accounts" && <AccountsTable accounts={accounts} />}
      {tab === "models" && <ModelGroups byModel={byModel} />}
    </div>
  );
}

function AccountsTable({ accounts }) {
  if (!accounts.length) return <EmptyState icon="group" text="No accounts configured." />;

  // Sort: active first, then idle, then banned/paused
  const sorted = [...accounts].sort((a, b) => {
    const rank = (a) => {
      if (a.banned) return 3;
      if (a.paused) return 2;
      if (a.account_status === "active" || a.account_status === "streaming") return 0;
      return 1;
    };
    return rank(a) - rank(b) || (b.total_sessions || 0) - (a.total_sessions || 0);
  });

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead className="bg-bg-subtle border-b border-border">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Account</th>
              <th className="px-3 py-2.5 text-left font-semibold text-text-muted">Model</th>
              <th className="px-3 py-2.5 text-center font-semibold text-text-muted">Status</th>
              <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Sessions</th>
              <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Requests</th>
              <th className="px-3 py-2.5 text-right font-semibold text-text-muted">Tokens (↑/↓)</th>
              <th className="px-3 py-2.5 text-center font-semibold text-text-muted">Sessions</th>
              <th className="px-3 py-2.5 text-center font-semibold text-text-muted">Session TTL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.map((a) => {
              const isBanned = a.banned;
              const isPaused = a.paused;
              const isActive = a.account_status === "active" || a.account_status === "streaming";
              const statusColor = isBanned ? "bg-red-500" : isPaused ? "bg-amber-500" : isActive ? "bg-green-500" : "bg-gray-400";
              const statusText = isBanned ? (a.ban_reason || "banned") : isPaused ? "paused" : a.account_status || "idle";

              return (
                <tr key={a.id} className="hover:bg-bg-subtle transition-colors">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-main truncate max-w-[120px]" title={a.email || a.name}>{a.name || a.email || a.id}</div>
                    {a.email && <div className="text-[10px] text-text-muted truncate max-w-[120px]">{a.email}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">{(a.session_model || "").replace(/^[^/]+\//, "")}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                      <span className="text-xs">{statusText}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmt(a.total_sessions)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmt(a.local_usage?.requests)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="text-primary">{fmt(a.local_usage?.tokens_in)}</span>
                    <span className="text-text-muted"> / </span>
                    <span className="text-success">{fmt(a.local_usage?.tokens_out)}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {(() => {
                      const used = a.total_sessions || 0;
                      const limit = 6;
                      const color = used >= limit ? "text-red-500" : used >= limit - 1 ? "text-amber-500" : "text-text-muted";
                      return <span className={color}>{used}/{limit}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    <CountdownCell resetAt={a.session_expires_at} useRemainingMs={a.session_remaining_ms} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CountdownCell({ resetAt, useRemainingMs }) {
  // If we have remainingMs, compute expiry from now + remainingMs
  const expiryTs = resetAt || (useRemainingMs ? Date.now() + useRemainingMs : null);
  const label = useCountdown(expiryTs);
  if (!expiryTs) return <span className="text-text-muted">—</span>;
  // Green if more than 15 min, amber if 5-15, red if < 5
  const diff = new Date(expiryTs).getTime() - Date.now();
  const color = diff > 900000 ? "text-green-500" : diff > 300000 ? "text-amber-500" : "text-red-500";
  return <span className={`${color} font-medium`}>{label}</span>;
}

function ModelGroups({ byModel }) {
  const models = Object.entries(byModel);
  if (!models.length) return <EmptyState icon="dns" text="No model groups." />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
      {models.map(([model, info]) => {
        const total = info.total;
        const available = info.active + info.idle;
        const pct = total > 0 ? Math.round((available / total) * 100) : 0;
        const barColor = info.banned === total ? "bg-red-500" : pct > 60 ? "bg-green-500" : pct > 30 ? "bg-amber-500" : "bg-red-500";

        return (
          <Card key={model} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-text-main truncate">{model.replace(/^[^/]+\//, "")}</span>
              <span className="text-xs text-text-muted">{total} accounts</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums text-green-500">{available}</span>
              <span className="text-sm text-text-muted">/ {total} available</span>
            </div>
            <div className="h-2.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
              <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-text-muted">
              <span className="text-green-500">{info.active} active</span>
              <span>{info.idle} idle</span>
              {info.banned > 0 && <span className="text-red-500">{info.banned} banned</span>}
            </div>
            <div className="text-[10px] text-text-muted border-t border-border/50 pt-1">
              {fmt(info.sessions)} total sessions
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, text }) {
  return (
    <Card className="p-12 text-center text-text-muted">
      <span className="material-symbols-outlined text-[40px] text-text-muted/50">{icon}</span>
      <p className="mt-2">{text}</p>
    </Card>
  );
}
