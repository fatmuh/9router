import { NextResponse } from "next/server";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";
import { getAuditLog, getAuditActions } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/audit-log — paginated audit entries. Admin (users.manage) only.
// Query: ?action=X&page=1&pageSize=50&startDate=&endDate=
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx, "users.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const filter = {
    action: searchParams.get("action") || undefined,
    startDate: searchParams.get("startDate") || undefined,
    endDate: searchParams.get("endDate") || undefined,
    page: Number(searchParams.get("page")) || 1,
    pageSize: Number(searchParams.get("pageSize")) || 50,
  };

  const [result, actions] = await Promise.all([getAuditLog(filter), getAuditActions()]);
  return NextResponse.json({ ...result, actions });
}
