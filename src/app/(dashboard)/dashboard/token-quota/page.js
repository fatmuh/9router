"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, SegmentedControl } from "@/shared/components";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

function useCountdown(resetAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!resetAt) return null;
  const ms = Math.max(0, resetAt - now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (ms <= 0) return "now";
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

export default function TokenQuotaPage() {
  const [data, setData] = useState(null);
  const [quotaData, setQuotaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState("accounts");
  const [period, setPeriod] = useState("24h");

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, quotaRes] = await Promise.all([
        fetch(`/api/usage/stats?period=${period}`),
        fetch("/api/usage/quota"),
      ]);
      if (statsRes.ok) setData(await statsRes.json());
      if (quotaRes.ok) setQuotaData(await quotaRes.json());
    } catch {}
    setLoading(false);
    setLastUpdated(new Date());
  }, [period]);

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
  if (!data) return <Card className="p-8 text-center text-text-muted">Failed to load.</Card>;

  const stats = data;

  // Overview numbers
  const overviewCards = [
    {
      label: "Total Requests",
      value: fmt(stats.byProvider ? Object.values(stats.byProvider).reduce((a, p) => a + (p.requests || 0), 0) : 0),
      sub: period.toUpperCase(),
      cls: "text-text-main",
      icon: "sync",
    },
    {
      label: "Prompt Tokens ↑",
      value: fmt(stats.totalPromptTokens),
      sub: "input",
      cls: "text-primary",
      icon: "arrow_upward",
    },
    {
      label: "Completion Tokens ↓",
      value: fmt(stats.totalCompletionTokens),
      sub: "output",
      cls: "text-success",
      icon: "arrow_downward",
    },
    {
      label: "Total Cost",
      value: fmtCost(stats.totalCost),
      sub: period.toUpperCase(),
      cls: "text-warning",
      icon: "payments",
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header: tabs + period + live toggle */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "accounts", label: "By Account" },
            { value: "providers", label: "By Provider" },
            { value: "models", label: "By Model" },
          ]}
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
        />
        <div className="flex gap-2">
          {tab !== "models" && (
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
          )}
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

      {/* Token quota status (if user has a limit set) */}
      {quotaData?.status && !quotaData.status.isUnlimited && (
        <QuotaSection u={quotaData.status} />
      )}

      {/* Tab content */}
      {tab === "accounts" && <AccountTable stats={stats} />}
      {tab === "providers" && <ProviderTable stats={stats} />}
      {tab === "models" && <ModelTable stats={stats} />}
    </div>
  );
}

function QuotaSection({ u }) {
  const resetLabel = useCountdown(u.resetAt);
  const pct = u.percentFull || 0;
  const barColor = u.isFull ? "bg-red-500" : u.isNearFull ? "bg-amber-500" : pct > 50 ? "bg-blue-500" : "bg-green-500";

  return (
    <Card className="px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-main">Your Token Quota</span>
        <span className="text-text-muted">
          {fmt(u.usedTokens)} / {fmt(u.limitTokens)} tokens
        </span>
      </div>
      <div className="h-3 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-text-muted">
        <span>{fmt(u.remainingTokens)} remaining</span>
        <span>Resets in {u.notStarted ? "—" : resetLabel || "—"}</span>
      </div>
    </Card>
  );
}

function AccountTable({ stats }) {
  const accounts = Object.entries(stats.byAccount || {});
  if (!accounts.length) return <EmptyState icon="account_circle" text="No account usage yet." />;

  // Sort by total tokens desc
  accounts.sort(([, a], [, b]) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens));

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead className="bg-bg-subtle border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Model</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Provider</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Account</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Req</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Input ↑</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Output ↓</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {accounts.map(([key, a], i) => {
              const total = (a.promptTokens || 0) + (a.completionTokens || 0);
              return (
                <tr key={i} className="hover:bg-bg-subtle transition-colors">
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[140px]" title={a.rawModel}>{a.rawModel || "—"}</td>
                  <td className="px-4 py-2 text-text-muted">{a.provider || "—"}</td>
                  <td className="px-4 py-2 truncate max-w-[160px]" title={a.accountName}>{a.accountName || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmt(a.requests)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-primary">{fmt(a.promptTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success">{fmt(a.completionTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-warning">{fmtCost(a.cost)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-bg-subtle border-t-2 border-border">
            <tr className="font-semibold">
              <td colSpan={3} className="px-4 py-2 text-text-main">Total</td>
              <td className="px-4 py-2 text-right tabular-nums">{fmt(accounts.reduce((s, [, a]) => s + (a.requests || 0), 0))}</td>
              <td className="px-4 py-2 text-right tabular-nums text-primary">{fmt(accounts.reduce((s, [, a]) => s + (a.promptTokens || 0), 0))}</td>
              <td className="px-4 py-2 text-right tabular-nums text-success">{fmt(accounts.reduce((s, [, a]) => s + (a.completionTokens || 0), 0))}</td>
              <td className="px-4 py-2 text-right tabular-nums text-warning">{fmtCost(accounts.reduce((s, [, a]) => s + (a.cost || 0), 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function ProviderTable({ stats }) {
  const providers = Object.entries(stats.byProvider || {});
  if (!providers.length) return <EmptyState icon="dns" text="No provider usage yet." />;

  providers.sort(([, a], [, b]) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens));

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead className="bg-bg-subtle border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Provider</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Requests</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Input ↑</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Output ↓</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Cached</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {providers.map(([prov, p], i) => {
              const total = (p.promptTokens || 0) + (p.completionTokens || 0);
              const pct = stats.totalPromptTokens + stats.totalCompletionTokens > 0
                ? Math.round((total / (stats.totalPromptTokens + stats.totalCompletionTokens)) * 100)
                : 0;
              return (
                <tr key={i} className="hover:bg-bg-subtle transition-colors">
                  <td className="px-4 py-2 font-semibold text-text-main">
                    <span className="capitalize">{prov}</span>
                    <span className="ml-2 text-xs text-text-muted">{pct}%</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmt(p.requests)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-primary">{fmt(p.promptTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success">{fmt(p.completionTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmt(p.cachedTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-warning">{fmtCost(p.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ModelTable({ stats }) {
  const models = Object.entries(stats.byModel || {});
  if (!models.length) return <EmptyState icon="model_training" text="No model usage yet." />;

  models.sort(([, a], [, b]) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens));

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead className="bg-bg-subtle border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Model</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Provider</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Requests</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Input ↑</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Output ↓</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Last Used</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {models.map(([key, m], i) => (
              <tr key={i} className="hover:bg-bg-subtle transition-colors">
                <td className="px-4 py-2 font-mono text-xs truncate max-w-[180px]" title={m.rawModel}>{m.rawModel || key}</td>
                <td className="px-4 py-2 text-text-muted">{m.provider || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-text-muted">{fmt(m.requests)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-primary">{fmt(m.promptTokens)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-success">{fmt(m.completionTokens)}</td>
                <td className="px-4 py-2 text-right text-xs text-text-muted whitespace-nowrap">{m.lastUsed || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
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
