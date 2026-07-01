import { NextResponse } from "next/server";
import { getQuotaStatus, getRecentRequestsByUser, getUsageByUserSince } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

// GET /api/usage/quota — the LOGGED-IN user's own token quota status + recent requests.
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statuses = await getQuotaStatus(ctx.userId);
  const status = statuses[0] || null;

  // Recent requests + per-model breakdown within the current window (or last 24h if unlimited).
  const sinceIso = status?.windowStart || new Date(Date.now() - 86400000).toISOString();
  const [recentRequests, byModel] = await Promise.all([
    getRecentRequestsByUser(ctx.userId, 50),
    getUsageByUserSince(ctx.userId, sinceIso),
  ]);

  return NextResponse.json({
    username: ctx.username,
    userId: ctx.userId,
    status,
    recentRequests,
    byModel,
  });
}
