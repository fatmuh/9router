import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, logAudit } from "@/lib/localDb";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

// Helper: can the current user manage this key? (owner OR keys.view.all)
async function canManageKey(ctx, key) {
  if (!ctx) return false;
  if (hasPermission(ctx, "keys.view.all")) return true;
  return key?.userId === ctx.userId;
}

// GET /api/keys/[id]
export async function GET(request, { params }) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!(await canManageKey(ctx, key))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // Mask raw key unless owner.
    const isOwner = key.userId === ctx.userId;
    return NextResponse.json({ key: { ...key, key: isOwner ? key.key : maskKey(key.key) } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id]
export async function PUT(request, { params }) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!(await canManageKey(ctx, existing))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { isActive, allowedModels, expiresAt, note } = body;
    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (allowedModels !== undefined) updateData.allowedModels = allowedModels;
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt;
    if (note !== undefined) updateData.note = note;

    const updated = await updateApiKey(id, updateData);
    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id]
export async function DELETE(request, { params }) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const existing = await getApiKeyById(id);
    if (!existing) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    if (!(await canManageKey(ctx, existing))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const deleted = await deleteApiKey(id);
    if (!deleted) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    await logAudit({
      action: "key.delete",
      actorUserId: ctx.userId,
      actorUsername: ctx.username,
      targetType: "apiKey",
      targetId: id,
      meta: { name: existing.name },
    });
    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}

function maskKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}
