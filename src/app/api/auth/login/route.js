import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { authenticateUser } from "@/lib/auth/authContext";
import { getRoleById } from "@/lib/db/repos/rolesRepo.js";
import { touchUserLogin, countUsers, logAudit } from "@/lib/localDb";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    // If no users exist yet, instruct client to run setup.
    if ((await countUsers()) === 0) {
      return NextResponse.json({ error: "Setup required", needsSetup: true }, { status: 409 });
    }

    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      const { remainingBeforeLock } = recordFail(ip);
      await logAudit({
        action: "user.login_failed",
        actorUsername: username || null,
        targetType: "user",
        ip,
        meta: { reason: "invalid_credentials" },
      });
      const postLock = checkLock(ip);
      if (postLock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`, retryAfter: postLock.retryAfter },
          { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
        );
      }
      return NextResponse.json(
        { error: `Invalid username or password. ${remainingBeforeLock} attempt(s) left.`, remainingBeforeLock },
        { status: 401 }
      );
    }

    recordSuccess(ip);
    await touchUserLogin(user.id);
    const role = await getRoleById(user.roleId);

    await logAudit({
      action: "user.login",
      actorUserId: user.id,
      actorUsername: user.username,
      targetType: "user",
      targetId: user.id,
      ip,
      meta: { method: "password" },
    });

    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
      roleName: role?.name || null,
    });

    return NextResponse.json({ success: true, username: user.username, roleName: role?.name }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
