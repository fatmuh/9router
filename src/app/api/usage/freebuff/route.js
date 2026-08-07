import { NextResponse } from "next/server";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

const PROXY_BASE = process.env.FREEBUFF_PROXY_URL || "http://environtment-proxy-freebuff-dylvrt:9187";
const PROXY_KEY = process.env.FREEBUFF_PROXY_KEY || "moccilabs-freebuff-2026";

// GET /api/usage/freebuff — proxy to freebuff-proxy dashboard API
// Returns: { accounts: [{ id, name, email, session_model, account_status, rate_limit, total_sessions, ... }] }
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx, "usage.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [usageRes, summaryRes] = await Promise.all([
      fetch(`${PROXY_BASE}/api/accounts/usage`, {
        headers: { "Authorization": `Bearer ${PROXY_KEY}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
      fetch(`${PROXY_BASE}/api/usage/summary`, {
        headers: { "Authorization": `Bearer ${PROXY_KEY}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
    ]);

    const result = { accounts: [], summary: null };

    if (usageRes?.ok) {
      result.accounts = (await usageRes.json()).accounts || [];
    }
    if (summaryRes?.ok) {
      result.summary = await summaryRes.json();
    }

    if (!usageRes?.ok && !summaryRes?.ok) {
      return NextResponse.json({ error: "Freebuff proxy unreachable" }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] freebuff usage error:", error?.message);
    return NextResponse.json({ error: "Failed to fetch freebuff data" }, { status: 500 });
  }
}
