import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb, logAudit } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

const CLI_TOKEN_HEADER = "x-9r-cli-token";

// CLI token requests are already trusted (local machine); skip session re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

// Auth for the backup endpoint: the logged-in JWT session (settings.manage)
// or a trusted CLI token. The legacy dashboard password fallback was removed.
async function authorize(request) {
  if (isCliRequest(request)) return true;
  const ctx = await getAuthContext(request);
  if (ctx && hasPermission(ctx, "settings.manage")) return ctx;
  return false;
}

export async function GET(request) {
  try {
    const ctx = await authorize(request);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const full = new URL(request.url).searchParams.get("full") === "true";
    const payload = await exportDb();
    // Config-only backup (default): drop the two heavy operational tables so the
    // file stays small (a few MB) and round-trips through the browser fine.
    // ?full=true restores the complete backup including request history.
    if (!full) {
      delete payload.usageHistory;
      delete payload.requestDetails;
      payload._scope = "config";
    } else {
      payload._scope = "full";
    }
    await logAudit({ action: full ? "backup.export_full" : "backup.export", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "settings" });
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const ctx = await authorize(request);
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { password, ...payload } = body;
    await importDb(payload);
    await logAudit({ action: "backup.import", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "settings" });

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
