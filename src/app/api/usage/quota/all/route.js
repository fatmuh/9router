import { NextResponse } from "next/server";
import { getQuotaStatus } from "@/lib/localDb";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

// GET /api/usage/quota/all — ALL users' token quota status (admin only).
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx, "usage.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const statuses = await getQuotaStatus(null);
  return NextResponse.json({ statuses });
}
