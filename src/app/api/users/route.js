import { NextResponse } from "next/server";
import { getUsers, createUser, logAudit } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.permissions.has("users.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await getUsers();
  // Never expose password hashes.
  return NextResponse.json({ users: users.map((u) => ({ ...u, passwordHash: undefined })) });
}

export async function POST(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.permissions.has("users.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { username, password, roleId, isActive, oidcSubject, allowedModels, limitTokens, limitWindowMs } = await request.json();
    const user = await createUser({ username, password, roleId, isActive, oidcSubject, allowedModels, limitTokens, limitWindowMs });
    await logAudit({ action: "user.create", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "user", targetId: user.id, meta: { username } });
    return NextResponse.json({ user: { ...user, passwordHash: undefined } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
