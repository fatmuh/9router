import { NextResponse } from "next/server";
import { createUser, countUsers, getUserByUsername } from "@/lib/localDb";
import { ensureSystemAdminRole } from "@/lib/localDb";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";

// GET — is setup needed? (no users exist yet)
export async function GET() {
  const c = await countUsers();
  // Don't leak the user count publicly — only whether setup is still required.
  return NextResponse.json({ needsSetup: c === 0 });
}

// POST — create the first admin user (wizard submission).
export async function POST(request) {
  const c = await countUsers();
  if (c > 0) {
    return NextResponse.json({ error: "Setup already complete" }, { status: 409 });
  }
  try {
    const { username, password } = await request.json();
    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const adminRoleId = await ensureSystemAdminRole();
    const existing = await getUserByUsername(username.trim());
    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    const user = await createUser({ username: username.trim(), password, roleId: adminRoleId });
    // Auto-login the new admin.
    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
    });
    return NextResponse.json({ success: true, userId: user.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
