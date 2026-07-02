"use client";

import { useState, useEffect } from "react";
import { Card, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import ProviderIcon from "@/shared/components/ProviderIcon";

export default function MyModelsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { copied, copy } = useCopyToClipboard(1500);

  useEffect(() => {
    fetch("/api/my-models")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Card className="p-8 text-center text-text-muted">Loading…</Card>;
  if (!data) return <Card className="p-8 text-center text-text-muted">Failed to load.</Card>;

  const allModels = (data.groups || []).flatMap((g) => g.models.map((m) => ({ ...m, providerName: g.name, providerId: g.providerId, color: g.color })));
  const filtered = search.trim()
    ? allModels.filter((m) => (m.value || "").toLowerCase().includes(search.toLowerCase()) || (m.name || "").toLowerCase().includes(search.toLowerCase()))
    : allModels;
  const filteredValues = new Set(filtered.map((m) => m.value));

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-[28px] text-primary">lists</span>
            My Models
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {data.unlimited
              ? "Your account has no model restriction — you can use all available models."
              : `${data.allowedCount} model pattern(s) allowed. Copy any model id below to use in your client.`}
          </p>
        </div>
        <Button icon="content_copy" variant="ghost" size="sm" onClick={() => copy(allModels.map((m) => m.value).join("\n"), "all")}>
          {copied === "all" ? "Copied!" : "Copy All"}
        </Button>
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search models…"
        className="w-full px-3 py-2 rounded-lg border border-border bg-bg-input text-sm focus:outline-none focus:border-primary"
      />

      {/* Combos */}
      {data.combos && data.combos.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-primary">layers</span> Combos
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.combos.map((c) => (
              <ModelChip key={c.value || c.id} label={c.name || c.id} value={c.value || c.id} onCopy={copy} copied={copied === (c.value || c.id)} />
            ))}
          </div>
        </Card>
      )}

      {/* Model groups */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-text-muted">
          <span className="material-symbols-outlined text-[32px] text-text-muted/50">search_off</span>
          <p className="mt-2">{search ? "No models match your search." : "No models available."}</p>
        </Card>
      ) : (
        (data.groups || [])
          .map((g) => {
            const models = (g.models || []).filter((m) => filteredValues.has(m.value));
            if (!models.length) return null;
            return (
              <Card key={g.providerId || g.name} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ProviderIcon src={g.icon} alt={g.name} size={20} className="object-contain rounded max-w-[20px] max-h-[20px]" fallbackText={(g.name || "?").slice(0, 2).toUpperCase()} fallbackColor={g.color} />
                  <h2 className="text-sm font-semibold">{g.name}</h2>
                  <span className="text-xs text-text-muted">{models.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => (
                    <ModelChip key={m.value} label={m.name} value={m.value} onCopy={copy} copied={copied === m.value} custom={m.isCustom} />
                  ))}
                </div>
              </Card>
            );
          })
      )}
    </div>
  );
}

function ModelChip({ label, value, onCopy, copied, custom }) {
  return (
    <button
      onClick={() => onCopy(value, value)}
      className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-bg-input hover:border-primary/40 transition-colors text-xs"
      title={`Copy: ${value}`}
    >
      <span className="font-mono text-text-main">{label}</span>
      {custom && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-500">custom</span>}
      <span className={`material-symbols-outlined text-[14px] ${copied ? "text-green-500" : "text-text-muted group-hover:text-primary"}`}>
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}
