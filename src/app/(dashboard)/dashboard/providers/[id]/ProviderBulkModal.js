"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function downloadBlob(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Inline preview of the accepted JSON format — so users know which fields to fill.
const FORMAT_PREVIEW = `{
  "nodes": [
    {
      "id": "my-ollama",
      "type": "openai-compatible",
      "name": "My Ollama",
      "prefix": "ollama",
      "baseUrl": "http://localhost:11434/v1"
    }
  ],
  "connections": [
    {
      "provider": "openai",
      "authType": "apikey",
      "name": "Prod Key",
      "apiKey": "sk-xxxxxxxx",
      "priority": 1,
      "isActive": true
    }
  ]
}`;

// ProviderBulkModal — per-provider Bulk Add (paste keys) + Import JSON + Export.
// Import is done client-side, one connection at a time, so progress is live.
export default function ProviderBulkModal({
  open,
  onClose,
  providerId,
  providerName,
  canBulkAdd = true,
  authType = "apikey",
  onImported,
}) {
  const [tab, setTab] = useState("import");
  const [keysText, setKeysText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, label }
  const [result, setResult] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const notify = useNotificationStore();

  const doExport = useCallback(async () => {
    try {
      const res = await fetch(`/api/providers/export?provider=${encodeURIComponent(providerId)}`);
      if (!res.ok) throw new Error("Export failed");
      const text = await res.text();
      downloadBlob(`9router-provider-${providerId}.json`, text);
      notify.success(`Exported ${providerName || providerId}`);
    } catch (e) {
      notify.error(`Export failed: ${e.message}`);
    }
  }, [providerId, providerName, notify]);

  // Import a list of connection payloads one-by-one, updating progress live.
  const importSequentially = useCallback(
    async (connections, nodes = []) => {
      const total = nodes.length + connections.length;
      let current = 0;
      let connsImported = 0;
      let connsSkipped = 0;
      let nodesImported = 0;
      let nodesSkipped = 0;
      const errors = [];

      setBusy(true);
      setProgress({ current: 0, total, label: "starting…" });

      // 1. nodes first
      for (const n of nodes) {
        current++;
        setProgress({ current, total, label: `node: ${n.name || n.id || current}` });
        try {
          await fetch("/api/providers/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodes: [n] }),
          }).then((r) => r.json());
          nodesImported++;
        } catch {
          nodesSkipped++;
        }
      }

      // 2. connections one at a time
      for (const c of connections) {
        current++;
        setProgress({ current, total, label: `key: ${c.name || c.apiKey?.slice(0, 8) || current}` });
        try {
          const res = await fetch("/api/providers/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connections: [c] }),
          });
          const data = await res.json();
          if (res.ok && data.summary?.connections?.imported > 0) {
            connsImported++;
          } else {
            connsSkipped++;
            if (data?.error) errors.push({ name: c.name, error: data.error });
          }
        } catch (e) {
          connsSkipped++;
          errors.push({ name: c.name, error: String(e?.message || e) });
        }
      }

      setProgress(null);
      setResult({
        nodes: { imported: nodesImported, skipped: nodesSkipped },
        connections: { imported: connsImported, skipped: connsSkipped },
        errors,
      });

      // Auto-test so statuses aren't left "unknown".
      let testSummary = null;
      if (connsImported > 0) {
        setProgress({ current: total, total, label: "testing connections…" });
        try {
          const tRes = await fetch("/api/providers/test-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "provider", providerId }),
          });
          const tData = await tRes.json();
          if (tRes.ok && tData.summary) testSummary = tData.summary;
        } catch {}
        setProgress(null);
        setResult((prev) => (prev ? { ...prev, test: testSummary } : prev));
      }

      setBusy(false);
      if (connsImported > 0 || nodesImported > 0) {
        notify.success(
          testSummary
            ? `Imported ${connsImported} connection(s). Tested: ${testSummary.passed}/${testSummary.total} OK`
            : `Imported ${nodesImported} node(s), ${connsImported} connection(s)`
        );
        if (onImported) onImported();
      } else {
        notify.error("Nothing imported");
      }
    },
    [notify, onImported, providerId]
  );

  // Bulk add: transform pasted keys (one per line) → connections, import sequentially.
  const doBulkAddKeys = useCallback(async () => {
    const keys = keysText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      notify.error("Paste at least one key (one per line)");
      return;
    }
    setResult(null);
    const base = (providerName || providerId).toLowerCase().replace(/\s+/g, "-");
    const stamp = Date.now().toString().slice(-4);
    const connections = keys.map((k, i) => ({
      provider: providerId,
      authType,
      apiKey: k,
      name: `${base}-${stamp}-${i + 1}`,
      isActive: true,
    }));
    await importSequentially(connections);
    setKeysText("");
  }, [keysText, providerId, providerName, authType, importSequentially, notify]);

  // Import JSON: parse textarea, import sequentially with live progress.
  const doImportJson = useCallback(async () => {
    const trimmed = jsonText.trim();
    if (!trimmed) {
      notify.error("Paste JSON first");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      notify.error(`Invalid JSON: ${e.message}`);
      return;
    }
    setResult(null);
    let nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    let connections = Array.isArray(parsed.connections)
      ? parsed.connections
      : Array.isArray(parsed)
      ? parsed
      : [];
    if (nodes.length === 0 && connections.length === 0) {
      notify.error("No nodes or connections in JSON");
      return;
    }
    await importSequentially(connections, nodes);
    setJsonText("");
  }, [jsonText, importSequentially, notify]);

  const close = () => {
    if (busy) return;
    setKeysText("");
    setJsonText("");
    setResult(null);
    setProgress(null);
    onClose();
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Modal isOpen={open} onClose={close} title={`${providerName || providerId} — Import / Export`} size="lg">
      <div className="flex flex-col gap-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-bg-subtle rounded-lg w-fit flex-wrap">
          {[
            { id: "import", label: "Import JSON", icon: "upload" },
            ...(canBulkAdd ? [{ id: "bulk", label: "Bulk Add Keys", icon: "playlist_add" }] : []),
            { id: "export", label: "Export", icon: "download" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 ${
                tab === t.id ? "bg-bg text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Live progress bar */}
        {progress && (
          <div className="flex flex-col gap-1.5 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-primary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Importing… {progress.current}/{progress.total}
              </span>
              <span className="text-text-muted text-xs tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-text-muted">{progress.label}</span>
          </div>
        )}

        {/* Import JSON */}
        {tab === "import" && (
          <div className="flex flex-col gap-3">
            {/* Format preview (collapsible) */}
            <div>
              <button
                onClick={() => setShowPreview((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">{showPreview ? "expand_less" : "code"}</span>
                {showPreview ? "Hide" : "Show"} JSON format
              </button>
              {showPreview && (
                <pre className="mt-2 text-[11px] font-mono bg-bg-subtle border border-border rounded-lg p-3 overflow-x-auto text-text-muted leading-relaxed">
{FORMAT_PREVIEW}
                </pre>
              )}
              <p className="text-xs text-text-muted mt-1">
                Fill <code className="text-primary">name</code>, <code className="text-primary">priority</code>, <code className="text-primary">isActive</code> per connection as needed.
              </p>
            </div>

            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={9}
              placeholder='{ "nodes": [...], "connections": [...] }'
              className="w-full font-mono text-xs rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary resize-y"
              disabled={busy}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={doImportJson}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">upload</span>
                Import
              </button>
            </div>
          </div>
        )}

        {/* Bulk Add Keys */}
        {tab === "bulk" && canBulkAdd && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Paste API keys for <b>{providerName || providerId}</b> — one key per line.
            </p>
            <textarea
              value={keysText}
              onChange={(e) => setKeysText(e.target.value)}
              rows={8}
              placeholder={"sk-key-1\nsk-key-2\nsk-key-3"}
              className="w-full font-mono text-xs rounded-lg border border-border bg-bg px-3 py-2 focus:outline-none focus:border-primary resize-y"
              disabled={busy}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">
                {keysText.split(/\r?\n/).filter((l) => l.trim()).length} key(s) ready
              </span>
              <button
                onClick={doBulkAddKeys}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">playlist_add</span>
                Add All Keys
              </button>
            </div>
          </div>
        )}

        {/* Export */}
        {tab === "export" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Download all connections for <b>{providerName || providerId}</b> as JSON. Re-importable via the Import tab or on another install.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={doExport}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Download {providerName || providerId}.json
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="flex flex-col gap-1 px-4 py-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="text-sm font-medium text-green-600 dark:text-green-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Import complete
            </p>
            <div className="text-xs text-text-muted flex flex-col gap-0.5">
              {result.nodes.imported + result.nodes.skipped > 0 && (
                <span>Nodes: {result.nodes.imported} imported, {result.nodes.skipped} skipped</span>
              )}
              <span>
                Connections: {result.connections.imported} imported, {result.connections.skipped} skipped
              </span>
              {result.errors?.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400 mt-1">
                  {result.errors.length} error(s): {result.errors.slice(0, 3).map((e) => e.name || "?").join(", ")}
                  {result.errors.length > 3 ? "…" : ""}
                </span>
              )}
              {result.test && (
                <span className={`mt-1 ${result.test.failed > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                  Tested: {result.test.passed}/{result.test.total} OK{result.test.failed > 0 ? `, ${result.test.failed} failed` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
