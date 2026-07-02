import { NextResponse } from "next/server";
import { getUserById, updateUser, deleteUser, setUserPassword, logAudit } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

async function requireUserManager(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!ctx.permissions.has("users.manage")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

export async function GET(request, { params }) {
  const g = await requireUserManager(request);
  if (g.error) return g.error;
  const { id } = await params;
  const user = await getUserById(id);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user: { ...user, passwordHash: undefined } });
}

export async function PUT(request, { params }) {
  const g = await requireUserManager(request);
  if (g.error) return g.error;
  const ctx = g.ctx;
  const { id } = await params;
  const body = await request.json();
  try {
    // password handled by separate reset route; here only role/active/username.
    const { username, roleId, isActive, oidcSubject, allowedModels, limitTokens, limitWindowMs } = body;
    const updated = await updateUser(id, { username, roleId, isActive, oidcSubject, allowedModels, limitTokens, limitWindowMs });
    await logAudit({ action: "user.update", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "user", targetId: id, meta: { username, roleId, isActive } });
    return NextResponse.json({ user: { ...updated, passwordHash: undefined } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const g = await requireUserManager(request);
  if (g.error) return g.error;
  const ctx = g.ctx;
  const { id } = await params;
  try {
    const ok = await deleteUser(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAudit({ action: "user.delete", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "user", targetId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
