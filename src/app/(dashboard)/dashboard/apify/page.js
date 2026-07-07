"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge } from "@/shared/components";

export default function ApifyPage() {
  const [keys, setKeys] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [addName, setAddName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/keys");
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (error) {
      console.error("Failed to fetch keys:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/apify/account");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    }
  }, []);

  useEffect(() => { if (keys.length > 0) fetchAccounts(); }, [keys, fetchAccounts]);

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
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (key) => {
    try {
      await fetch("/api/apify/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id, isActive: !key.isActive }),
      });
      fetchKeys();
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = async (key) => {
    if (!confirm(`Delete key "${key.name || key.id}"?`)) return;
    try {
      await fetch(`/api/apify/keys?id=${key.id}`, { method: "DELETE" });
      fetchKeys();
    } catch (error) {
      console.error(error);
    }
  };

  const activeCount = keys.filter((k) => k.isActive).length;
  const totalUsage = keys.reduce((sum, k) => sum + (k.usageCount || 0), 0);

  // Account info map (key.id → account data)
  const accountMap = {};
  for (const a of accounts) { accountMap[a.id] = a; }

  // Aggregate stats
  const totalRequests = accounts.reduce((sum, a) => sum + (a.usage?.totalRequests || 0), 0);
  const totalCU = accounts.reduce((sum, a) => sum + (a.usage?.totalComputeUnits || 0), 0);
  const freeAccounts = accounts.filter((a) => a.plan === "free" || a.plan === "platform").length;
  const paidAccounts = accounts.filter((a) => a.plan && a.plan !== "free" && a.plan !== "platform").length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apify Gateway</h1>
          <p className="text-sm text-text-muted mt-1">
            Multi-account Apify proxy with round-robin key rotation
          </p>
        </div>
        <Button onClick={() => setAddMode(!addMode)} icon={addMode ? "close" : "add"}>
          {addMode ? "Cancel" : "Add Keys"}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-primary">{activeCount}/{keys.length}</p>
          <p className="text-xs text-text-muted mt-1">Keys Active</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-green-500">{totalRequests.toLocaleString()}</p>
          <p className="text-xs text-text-muted mt-1">Total Requests</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-amber-500">{totalCU.toLocaleString()}</p>
          <p className="text-xs text-text-muted mt-1">Compute Units</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-purple-500">{freeAccounts} free{paidAccounts > 0 ? ` / ${paidAccounts} paid` : ""}</p>
          <p className="text-xs text-text-muted mt-1">Plan Types</p>
        </Card>
      </div>

      {/* Add Keys */}
      {addMode && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Add Apify API Keys</h3>
          <p className="text-xs text-text-muted mb-3">
            Paste one API key per line. Get your key from{" "}
            <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener" className="text-primary hover:underline">
              Apify Console &gt; Settings &gt; Integrations
            </a>
          </p>
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Account name (optional, auto-numbered if empty)"
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
              {result.error
                ? result.error
                : `Added ${result.created || 0} key(s)${result.errors?.length ? `, ${result.errors.length} failed` : ""}`
              }
            </div>
          )}
        </Card>
      )}

      {/* API Usage Info */}
      <Card className="p-4">
        <h3 className="font-semibold mb-2">API Usage</h3>
        <p className="text-xs text-text-muted mb-2">
          Use this base URL instead of <code>api.apify.com</code>:
        </p>
        <div className="bg-bg-subtle rounded-lg p-3 font-mono text-xs">
          <span className="text-primary">GET</span> /apify/v2/{"{actor_id}"}/runs
        </div>
        <p className="text-xs text-text-muted mt-2">
          All Apify API v2 endpoints are supported. Keys are automatically rotated.
          Your Apify API keys are injected server-side — clients don&apos;t need to send them.
        </p>
      </Card>

      {/* Keys Table */}
      <Card>
        <div className="p-4 border-b border-border-subtle">
          <h3 className="font-semibold">API Keys ({keys.length})</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-text-muted">Loading...</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-text-muted">
            No API keys configured. Click &quot;Add Keys&quot; to get started.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{key.name || "Unnamed"}</span>
                    <Badge variant={key.isActive ? "success" : "error"} className="text-[10px]">
                      {key.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                    <code className="font-mono">{key.tokenPreview}</code>
                    {accountMap[key.id]?.username && (
                      <>
                        <span>•</span>
                        <span>@{accountMap[key.id].username}</span>
                      </>
                    )}
                    {accountMap[key.id]?.plan && (
                      <>
                        <span>•</span>
                        <Badge variant={accountMap[key.id].plan === "free" ? "info" : "success"} className="text-[9px]">
                          {accountMap[key.id].plan}
                        </Badge>
                      </>
                    )}
                    {accountMap[key.id]?.usage ? (
                      <>
                        <span>•</span>
                        <span>{(accountMap[key.id].usage.totalRequests || 0).toLocaleString()} req</span>
                        <span>•</span>
                        <span>{(accountMap[key.id].usage.totalComputeUnits || 0).toLocaleString()} CU</span>
                      </>
                    ) : (
                      <>
                        <span>•</span>
                        <span>{key.usageCount || 0} local req</span>
                      </>
                    )}
                    {key.lastUsedAt && (
                      <>
                        <span>•</span>
                        <span>Last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>
                      </>
                    )}
                    {key.lastError && (
                      <span className="text-red-500 truncate max-w-[200px]" title={key.lastError}>
                        ⚠ {key.lastError}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant={key.isActive ? "ghost" : "primary"}
                    onClick={() => handleToggle(key)}
                  >
                    {key.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => handleDelete(key)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
