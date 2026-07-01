import { NextResponse } from "next/server";
import { getApiKeys, createApiKey, claimLegacyKeys } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys (scoped to current user, unless keys.view.all)
export async function GET(request) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // First admin that logs in claims legacy keys.
    if (ctx.roleId === "role-admin" && !ctx.isLegacy) {
      await claimLegacyKeys(ctx.userId);
    }
    const viewAll = hasPermission(ctx, "keys.view.all");
    const keys = await getApiKeys(viewAll ? null : ctx.userId);
    // Non-view-all users never see raw key strings of others (already filtered), but mask anyway.
    return NextResponse.json({ keys, canViewAll: viewAll });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key (owned by current user)
export async function POST(request) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasPermission(ctx, "keys.own")) {
      return NextResponse.json({ error: "Forbidden: missing permission keys.own" }, { status: 403 });
    }
    const body = await request.json();
    const { name } = body;
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const machineId = await getConsistentMachineId();
    const { allowedModels, expiresAt, note } = body;
    const apiKey = await createApiKey(name, machineId, {
      allowedModels, expiresAt, note, userId: ctx.userId,
    });

    return NextResponse.json({
      key: apiKey.key, name: apiKey.name, id: apiKey.id, machineId: apiKey.machineId,
      allowedModels: apiKey.allowedModels, expiresAt: apiKey.expiresAt, note: apiKey.note,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
