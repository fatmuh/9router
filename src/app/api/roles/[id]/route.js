import { NextResponse } from "next/server";
import { getRoleById, updateRole, deleteRole, logAudit } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

async function requireRoleManager(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!ctx.permissions.has("roles.manage")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

export async function GET(request, { params }) {
  const g = await requireRoleManager(request);
  if (g.error) return g.error;
  const { id } = await params;
  const role = await getRoleById(id);
  if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ role });
}

export async function PUT(request, { params }) {
  const g = await requireRoleManager(request);
  if (g.error) return g.error;
  const { id } = await params;
  const body = await request.json();
  try {
    const updated = await updateRole(id, body);
    await logAudit({ action: "role.update", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "role", targetId: id, meta: { name: updated?.name } });
    return NextResponse.json({ role: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const g = await requireRoleManager(request);
  if (g.error) return g.error;
  const { id } = await params;
  try {
    const ok = await deleteRole(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAudit({ action: "role.delete", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "role", targetId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
