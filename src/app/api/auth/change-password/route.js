import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/authContext";
import { getUserById, verifyUserPassword, setUserPassword, logAudit } from "@/lib/localDb";

// POST /api/auth/change-password — self-service: verify current, set new.
export async function POST(request) {
  const ctx = await getAuthContext(request);
  if (!ctx || !ctx.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // OIDC-only users (no password hash) cannot use this flow.
  try {
    const { currentPassword, newPassword } = await request.json();
    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }
    const user = await getUserById(ctx.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Users with an existing password must verify it. OIDC-only accounts (no
    // passwordHash) may set one without a current password.
    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required" }, { status: 400 });
      }
      const ok = await verifyUserPassword(user, currentPassword);
      if (!ok) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    await setUserPassword(user.id, newPassword);
    await logAudit({ action: "user.change_password", actorUserId: ctx.userId, actorUsername: ctx.username, targetType: "user", targetId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to change password" }, { status: 500 });
  }
}
