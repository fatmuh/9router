"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

const OIDC_ERROR_MESSAGES = {
  oidc_no_subject: "OIDC provider did not return a subject identifier.",
  account_paused: "Your account is paused. Contact an administrator.",
  oidc_not_configured: "OIDC is not configured.",
  oidc_invalid_state: "OIDC state mismatch — please try again.",
  oidc_missing_code: "OIDC authorization code missing.",
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState(null);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      try {
        // If no users exist yet → go to setup wizard.
        const s = await fetch("/api/setup");
        if (s.ok) {
          const sd = await s.json();
          if (sd.needsSetup) { window.location.assign("/setup"); return; }
        }
        // Load auth config (to show/hide OIDC button).
        const r = await fetch("/api/auth/status");
        if (r.ok) setAuthConfig(await r.json());

        // Surface OIDC callback errors from the query string.
        const params = new URLSearchParams(window.location.search);
        const err = params.get("error");
        if (err) {
          setError(decodeURIComponent(err).replace(/\+/g, " ") || OIDC_ERROR_MESSAGES[err] || err);
        }
      } catch {}
    }
    checkAuth();
  }, []);

  const showPasswordForm = !authConfig || authConfig.authMode !== "oidc";
  const showOidcButton = authConfig?.oidcConfigured && (authConfig.authMode === "oidc" || authConfig.authMode === "both");
  const oidcLabel = authConfig?.oidcLoginLabel || "Sign in with OIDC";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        setError(data.error || "Login failed");
        if (data.retryAfter) setRetryAfter(data.retryAfter);
        if (data.needsSetup) window.location.assign("/setup");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-4">
            <span className="material-symbols-outlined text-[32px]">lock</span>
          </div>
          <h1 className="text-xl font-bold text-text-main">Sign in to 9Router</h1>
        </div>

        {/* OIDC button (shown when authMode is oidc/both and OIDC is configured) */}
        {showOidcButton && (
          <div className={showPasswordForm ? "mb-4" : ""}>
            <Button
              variant="secondary"
              fullWidth
              icon="login"
              onClick={() => { window.location.href = "/api/auth/oidc/start"; }}
            >
              {oidcLabel}
            </Button>
          </div>
        )}

        {/* Password form (hidden in oidc-only mode) */}
        {showPasswordForm && (
          <>
            {showOidcButton && (
              <div className="flex items-center gap-3 my-4">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-text-muted uppercase">or</span>
                <div className="h-px bg-border flex-1" />
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                autoFocus
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
              {error && (
                <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}
              {retryAfter > 0 && (
                <p className="text-xs text-text-muted text-center">Try again in {retryAfter}s</p>
              )}
              <Button type="submit" fullWidth disabled={loading || !username || !password}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </>
        )}

        {/* Error display when oidc-only mode (no password form) */}
        {!showPasswordForm && error && (
          <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
        )}
      </Card>
    </div>
  );
}
