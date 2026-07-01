/**
 * Unit tests for API key scoping.
 *
 * Covers the pure logic in src/lib/auth/apiKeyScope.js:
 *   - globToRegExp / isModelAllowed: pattern matching
 *   - resolveWindow: rolling-window anchor logic (used for per-USER quota)
 *   - checkApiKeyScope: active/expiry/model-whitelist gating (KEY-level only)
 *   - formatWindowMs
 *
 * Note: token QUOTA is enforced at the USER level (enforceApiKeyAccess →
 * resolveWindow(user) + getTokenUsageByUserSince), not per-key, so it is not
 * part of checkApiKeyScope anymore.
 */

import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  isModelAllowed,
  resolveWindow,
  checkApiKeyScope,
  formatWindowMs,
} from "@/lib/auth/apiKeyScope.js";

const NOW = new Date("2026-07-01T12:00:00Z").getTime();
const HOUR = 3_600_000;

describe("globToRegExp / isModelAllowed", () => {
  it("empty list allows everything", () => {
    expect(isModelAllowed("anything", [])).toBe(true);
    expect(isModelAllowed("anything", null)).toBe(true);
  });

  it("trailing * matches any suffix", () => {
    expect(isModelAllowed("gemini-3.1-pro", ["gemini-*"])).toBe(true);
    expect(isModelAllowed("claude-opus-4", ["gemini-*"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isModelAllowed("GPT-5.5", ["gpt-5*"])).toBe(true);
  });

  it("literal dot is not a wildcard", () => {
    expect(isModelAllowed("modelXv2", ["model.v2"])).toBe(false);
    expect(isModelAllowed("model.v2", ["model.v2"])).toBe(true);
  });

  it("multiple patterns are OR-ed", () => {
    expect(isModelAllowed("claude-opus-4", ["gemini-*", "claude-*"])).toBe(true);
  });
});

describe("resolveWindow", () => {
  it("returns hasLimit=false when no limit set", () => {
    const r = resolveWindow({}, NOW);
    expect(r.hasLimit).toBe(false);
    expect(r.windowStart).toBe(null);
  });

  it("returns hasLimit=false when only tokens set (no window)", () => {
    expect(resolveWindow({ limitTokens: 1000, limitWindowMs: 0 }, NOW).hasLimit).toBe(false);
    expect(resolveWindow({ limitTokens: 0, limitWindowMs: HOUR }, NOW).hasLimit).toBe(false);
  });

  it("starts a new window on first use (windowStartedAt null)", () => {
    const r = resolveWindow({ limitTokens: 1000, limitWindowMs: 5 * HOUR, windowStartedAt: null }, NOW);
    expect(r.hasLimit).toBe(true);
    expect(r.isNew).toBe(true);
    expect(r.windowStart).toBe(NOW);
    expect(r.resetAt).toBe(NOW + 5 * HOUR);
  });

  it("reuses existing window when still within duration", () => {
    const start = NOW - HOUR; // 1h into a 5h window
    const r = resolveWindow({ limitTokens: 1000, limitWindowMs: 5 * HOUR, windowStartedAt: new Date(start).toISOString() }, NOW);
    expect(r.isNew).toBe(false);
    expect(r.windowStart).toBe(start);
    expect(r.resetAt).toBe(start + 5 * HOUR);
  });

  it("starts a new window when existing window has expired", () => {
    const start = NOW - 6 * HOUR; // 6h ago, window was 5h → expired
    const r = resolveWindow({ limitTokens: 1000, limitWindowMs: 5 * HOUR, windowStartedAt: new Date(start).toISOString() }, NOW);
    expect(r.isNew).toBe(true);
    expect(r.windowStart).toBe(NOW);
    expect(r.resetAt).toBe(NOW + 5 * HOUR);
  });

  it("ignores malformed windowStartedAt", () => {
    const r = resolveWindow({ limitTokens: 1000, limitWindowMs: HOUR, windowStartedAt: "garbage" }, NOW);
    expect(r.isNew).toBe(true);
    expect(r.windowStart).toBe(NOW);
  });
});

describe("checkApiKeyScope", () => {
  const baseKey = {
    isActive: true,
    expiresAt: null,
    allowedModels: [],
  };

  it("passes for an unrestricted active key", () => {
    expect(checkApiKeyScope(baseKey, { model: "any" })).toEqual({ ok: true });
  });

  it("rejects a null record", () => {
    expect(checkApiKeyScope(null, {}).ok).toBe(false);
  });

  it("rejects a paused key (code: paused)", () => {
    const r = checkApiKeyScope({ ...baseKey, isActive: false }, { model: "x" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("paused");
  });

  it("rejects an expired key (code: expired)", () => {
    const r = checkApiKeyScope(
      { ...baseKey, expiresAt: new Date(Date.now() - 1000).toISOString() },
      { model: "x" }
    );
    expect(r.code).toBe("expired");
  });

  it("allows a future expiry", () => {
    const r = checkApiKeyScope(
      { ...baseKey, expiresAt: new Date(Date.now() + 86400000).toISOString() },
      { model: "x" }
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a model not in whitelist (code: model_not_allowed)", () => {
    const r = checkApiKeyScope({ ...baseKey, allowedModels: ["gemini-*"] }, { model: "claude-opus" });
    expect(r.code).toBe("model_not_allowed");
  });

  // Token quota is no longer a KEY-level concern — it moved to the USER level
  // (account-wide). checkApiKeyScope intentionally ignores any token fields now.
  it("ignores token usage entirely (quota is user-level)", () => {
    expect(checkApiKeyScope(baseKey, { model: "x", tokensUsed: 999999 }).ok).toBe(true);
  });

  it("expiry gate is evaluated before model (first-failure wins)", () => {
    const r = checkApiKeyScope(
      {
        isActive: true,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        allowedModels: ["gemini-*"],
      },
      { model: "claude" }
    );
    expect(r.code).toBe("expired");
  });
});

describe("formatWindowMs", () => {
  it("formats minutes/hours/days", () => {
    expect(formatWindowMs(30 * 60_000)).toBe("30m");
    expect(formatWindowMs(5 * 3_600_000)).toBe("5h");
    expect(formatWindowMs(2 * 86_400_000)).toBe("2d");
  });
  it("returns empty string for 0/negative", () => {
    expect(formatWindowMs(0)).toBe("");
    expect(formatWindowMs(-1)).toBe("");
  });
});
