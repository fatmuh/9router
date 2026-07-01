"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, SegmentedControl } from "@/shared/components";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtPct = (n) => `${Math.round(n || 0)}%`;

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

export default function TokenQuotaPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/quota");
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
    setLastUpdated(new Date());
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
  if (!data) return <Card className="p-8 text-center text-text-muted">Failed to load.</Card>;

  const u = data.status;
  const unlimited = !u || u.isUnlimited;

  // Build a Usage-style stats object for OverviewCards (reuse the same component).
  const totals = (data.recentRequests || []).reduce(
    (acc, r) => {
      acc.totalRequests += 1;
      acc.totalPromptTokens += r.promptTokens || 0;
      acc.totalCompletionTokens += r.completionTokens || 0;
      acc.totalCost += r.cost || 0;
      return acc;
    },
    { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0 }
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + live toggle on same row — mirrors Usage page layout */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
        />
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

      {tab === "overview" && (
        <>
          {/* Reuse the exact OverviewCards from Usage page */}
          <OverviewCards stats={totals} />

          {/* Quota-specific card: limit + progress + countdown */}
          {unlimited ? (
            <Card className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[26px]">all_inclusive</span>
              </div>
              <div>
                <p className="font-semibold text-text-main">No token limit set</p>
                <p className="text-sm text-text-muted">Your account is unlimited. All your API keys work without restriction.</p>
              </div>
            </Card>
          ) : (
            <QuotaSection u={u} />
          )}

          {/* Reuse the Usage chart (shows your requests over time) */}
          <UsageChart period="24h" />
        </>
      )}

      {tab === "details" && <RequestTable requests={data.recentRequests || []} />}
    </div>
  );
}

function QuotaSection({ u }) {
  const resetLabel = useCountdown(u.resetAt);
  const color = u.isFull ? "red" : u.isNearFull ? "amber" : u.percentFull > 50 ? "blue" : "green";
  const barColor = { red: "bg-red-500", amber: "bg-amber-500", blue: "bg-blue-500", green: "bg-green-500" }[color];
  const textColor = { red: "text-red-500", amber: "text-amber-600 dark:text-amber-400", blue: "text-blue-500", green: "text-green-600 dark:text-green-400" }[color];

  // Quota-specific stat cards (same grid style as OverviewCards)
  const quotaCards = [
    {
      label: "Tokens Used",
      value: fmt(u.usedTokens),
      sub: `${fmtPct(u.percentFull)} of limit`,
      cls: textColor,
    },
    {
      label: "Token Limit",
      value: fmt(u.limitTokens),
      sub: u.windowLabel ? `${u.windowLabel} window` : "",
      cls: "text-text-main",
    },
    {
      label: "Remaining",
      value: fmt(u.remainingTokens),
      sub: u.remainingTokens > 0 ? "available" : "exhausted",
      cls: u.remainingTokens > 0 ? "text-success" : "text-red-500",
    },
    {
      label: "Resets In",
      value: u.notStarted ? "—" : resetLabel || "—",
      sub: u.notStarted ? "not started" : u.resetAt ? new Date(u.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
      cls: u.isFull ? "text-red-500" : "text-warning",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Stat cards grid — same style as Usage OverviewCards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
        {quotaCards.map((c) => (
          <Card key={c.label} className="flex min-w-0 flex-col gap-1 px-4 py-3">
            <span className="text-text-muted text-sm uppercase font-semibold">{c.label}</span>
            <span className={`truncate text-2xl font-bold tabular-nums ${c.cls}`}>{c.value}</span>
            {c.sub && <span className="text-[10px] text-text-muted">{c.sub}</span>}
          </Card>
        ))}
      </div>

      {/* Progress bar */}
      <Card className="px-5 py-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-text-main">Quota Progress</span>
          <span className={`font-medium ${textColor}`}>
            {u.isFull ? "Limit reached" : `${fmt(u.remainingTokens)} tokens left`}
          </span>
        </div>
        <div className="h-3 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${u.percentFull}%` }} />
        </div>
        {u.notStarted && (
          <p className="text-xs text-blue-500 flex items-center gap-1 mt-0.5">
            <span className="material-symbols-outlined text-[14px]">play_circle</span>
            Window starts on your first request
          </p>
        )}
      </Card>
    </div>
  );
}

function RequestTable({ requests }) {
  const fmtTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (!requests.length) {
    return (
      <Card className="p-12 text-center text-text-muted">
        <span className="material-symbols-outlined text-[40px] text-text-muted/50">inbox</span>
        <p className="mt-2">No requests yet.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-bg-subtle border-b border-border">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">When</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Model</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">Provider</th>
              <th className="px-4 py-2.5 text-left font-semibold text-text-muted">API Key</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Input ↑</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Output ↓</th>
              <th className="px-4 py-2.5 text-right font-semibold text-text-muted">Total</th>
              <th className="px-4 py-2.5 text-center font-semibold text-text-muted">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {requests.map((r, i) => {
              const ok = !r.status || r.status === "ok" || r.status === "success";
              return (
                <tr key={i} className="hover:bg-bg-subtle transition-colors">
                  <td className="px-4 py-2 text-text-muted whitespace-nowrap">{fmtTime(r.timestamp)}</td>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[160px]" title={r.model}>{r.model || "—"}</td>
                  <td className="px-4 py-2 text-text-muted">{r.provider || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-text-muted">{r.apiKeyMasked || "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-primary">{fmt(r.promptTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-success">{fmt(r.completionTokens)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(r.tokens)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-success" : "bg-error"}`} />
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
