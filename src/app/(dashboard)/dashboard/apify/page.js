"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Badge, Pagination, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/components";

// ── Main Page ──
export default function ApifyPage() {
  // Table state (server-side pagination)
  const [keys, setKeys] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  // Account data (still fetched separately for balance/plan)
  const [accounts, setAccounts] = useState({});
  const [accountLoading, setAccountLoading] = useState(false);

  // Add modal
  const [addMode, setAddMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [addName, setAddName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const searchTimer = useRef(null);

  // Debounced search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchInput]);

  // Fetch keys (server-side paginated)
  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/apify/keys?${params}`);
      const data = await res.json();
      setKeys(data.keys || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  // Fetch account info for current page keys only
  const fetchAccounts = useCallback(async () => {
    if (keys.length === 0) return;
    setAccountLoading(true);
    try {
      const res = await fetch("/api/apify/account");
      const data = await res.json();
      const map = {};
      for (const a of data.accounts || []) { map[a.id] = a; }
      setAccounts(map);
    } catch (e) {
      console.error(e);
    } finally {
      setAccountLoading(false);
    }
  }, [keys]);

  useEffect(() => { if (keys.length > 0) fetchAccounts(); }, [fetchAccounts]);

  // Actions
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
    if (!confirm(`Delete key "${key.name || key.tokenPreview}"?`)) return;
    try {
      await fetch(`/api/apify/keys?id=${key.id}`, { method: "DELETE" });
      fetchKeys();
    } catch (e) { console.error(e); }
  };

  const handleToggle = async (key) => {
    try {
      await fetch("/api/apify/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id, isActive: !key.isActive }),
      });
      fetchKeys();
    } catch (e) { console.error(e); }
  };

  // Summary stats
  const activeKeys = keys.filter((k) => k.isActive).length;
  const accountList = Object.values(accounts);
  const totalRemaining = accountList.reduce((s, a) => s + (a.balance?.remainingUsd || 0), 0);
  const totalUsed = accountList.reduce((s, a) => s + (a.balance?.usedUsd || 0), 0);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apify Gateway</h1>
          <p className="text-sm text-text-muted mt-1">
            Multi-account proxy with round-robin key rotation
          </p>
        </div>
        <Button onClick={() => setAddMode(!addMode)} icon={addMode ? "close" : "add"}>
          {addMode ? "Cancel" : "Add Keys"}
        </Button>
      </div>

      {/* Summary bar */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{activeKeys}/{total}</p>
            <p className="text-xs text-text-muted mt-1">Active Keys</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-500">${totalRemaining.toFixed(2)}</p>
            <p className="text-xs text-text-muted mt-1">Total Remaining</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-500">${totalUsed.toFixed(4)}</p>
            <p className="text-xs text-text-muted mt-1">Total Used</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-500">{accountList.length}</p>
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
            placeholder="Account name (optional, applied to all)"
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
        <div className="bg-bg-subtle rounded-lg p-3 font-mono text-xs space-y-1">
          <div>
            <span className="text-primary">GET</span> /apify/v2/{"{actor_id}"}/run-sync-get-dataset-items
          </div>
          <div>
            <span className="text-green-500">BASE</span> https://api.moccilabs.com/apify/v2
          </div>
        </div>
        <p className="text-xs text-text-muted mt-2">
          All Apify v2 endpoints work 1:1. Keys are injected server-side via round-robin.
        </p>
      </Card>

      {/* Keys DataTable */}
      <Card className="p-4">
        {/* Search bar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[18px]">
              search
            </span>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or token..."
              className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-bg-input text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <span className="text-xs text-text-muted">{total} total</span>
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right">Usage</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-text-muted">
                  Loading...
                </TableCell>
              </TableRow>
            ) : keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-text-muted">
                  No keys found. Click &quot;Add Keys&quot; to get started.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((key) => {
                const acct = accounts[key.id];
                const remaining = acct?.balance?.remainingUsd;
                const used = acct?.balance?.usedUsd;
                const max = acct?.balance?.maxUsd;
                const pct = max && max > 0 ? (used / max) * 100 : 0;

                return (
                  <TableRow key={key.id}>
                    {/* Name */}
                    <TableCell>
                      <div>
                        <p className="font-medium text-text-primary">{key.name || "Unnamed"}</p>
                        {acct?.username && (
                          <p className="text-xs text-text-muted">@{acct.username}</p>
                        )}
                      </div>
                    </TableCell>

                    {/* Token preview */}
                    <TableCell>
                      <code className="text-xs text-text-muted font-mono">{key.tokenPreview}</code>
                    </TableCell>

                    {/* Plan */}
                    <TableCell>
                      <Badge variant={acct?.plan === "free" ? "default" : "primary"} size="sm">
                        {acct?.plan || "—"}
                      </Badge>
                    </TableCell>

                    {/* Remaining balance */}
                    <TableCell className="text-right">
                      {remaining !== undefined ? (
                        <span className={`font-bold ${remaining < 0.5 ? "text-red-500" : "text-green-500"}`}>
                          ${remaining.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </TableCell>

                    {/* Usage bar */}
                    <TableCell className="text-right">
                      {used !== undefined && max !== undefined ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xs text-text-muted">
                            ${used.toFixed(4)} / ${max.toFixed(2)}
                          </span>
                          <div className="w-24 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                            <div
                              className={`h-full rounded-full ${pct < 50 ? "bg-green-500" : pct < 80 ? "bg-yellow-500" : "bg-red-500"}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </TableCell>

                    {/* Request count */}
                    <TableCell className="text-right">
                      <span className="text-sm text-text-muted">{key.usageCount || 0}</span>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge variant={key.isActive ? "success" : "error"} size="sm">
                        {key.isActive ? "Active" : "Disabled"}
                      </Badge>
                      {acct?.error && (
                        <p className="text-xs text-red-500 mt-1 max-w-[120px] truncate" title={acct.error}>
                          {acct.error}
                        </p>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggle(key)}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          title={key.isActive ? "Disable" : "Enable"}
                        >
                          <span className={`material-symbols-outlined text-[18px] ${key.isActive ? "text-green-500" : "text-text-muted"}`}>
                            {key.isActive ? "toggle_on" : "toggle_off"}
                          </span>
                        </button>
                        <button
                          onClick={() => handleDelete(key)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-[18px] text-red-500">delete</span>
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Server-side pagination */}
        <Pagination
          currentPage={page}
          pageSize={limit}
          totalItems={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setLimit(size); setPage(1); }}
        />
      </Card>
    </div>
  );
}
