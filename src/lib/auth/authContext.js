// Resolve the authenticated user + effective permissions from a request's JWT cookie.
// Used by API routes and the dashboard guard.

import { cookies } from "next/headers";
import { getDashboardAuthSession } from "./dashboardSession.js";
import { getUserById, verifyUserPassword } from "@/lib/db/repos/usersRepo.js";
import { getRoleById } from "@/lib/db/repos/rolesRepo.js";
import { ALL_PERMISSIONS } from "@/shared/constants/permissions.js";

/**
 * Get the current session payload + resolved user + role + permission set.
 * Returns null if not authenticated.
 * @param {Request} [request] - optional, falls back to cookies()
 */
export async function getAuthContext(request) {
  let token = null;
  try {
    if (request) {
      // Extract from Authorization bearer or cookie header.
      const auth = request.headers.get("authorization");
      if (auth?.startsWith("Bearer ")) token = auth.slice(7);
      if (!token) {
        const cookieHeader = request.headers.get("cookie") || "";
        const m = cookieHeader.match(/auth_token=([^;]+)/);
        token = m ? decodeURIComponent(m[1]) : null;
      }
    } else {
      const cookieStore = await cookies();
      token = cookieStore.get("auth_token")?.value;
    }
  } catch { /* non-request context */ }

  const session = await getDashboardAuthSession(token);
  if (!session) return null;

  // Legacy tokens (pre-RBAC) carry only { authenticated: true }.
  // Treat them as admin so upgrades don't mass-lockout (tokens expire in 24h).
  if (!session.userId) {
    return {
      session,
      userId: null,
      username: null,
      roleId: "role-admin",
      roleName: "admin",
      permissions: new Set(ALL_PERMISSIONS),
      isLegacy: true,
    };
  }

  const user = await getUserById(session.userId);
  if (!user || !user.isActive) return null;
  const role = await getRoleById(user.roleId);
  const permissions = new Set(role?.permissions || []);
  return {
    session,
    userId: user.id,
    username: user.username,
    roleId: user.roleId,
    roleName: role?.name || null,
    permissions,
    isLegacy: false,
  };
}

/** Does the auth context have a given permission? */
export function hasPermission(ctx, permission) {
  if (!ctx) return false;
  return ctx.permissions.has(permission);
}

/** Verify username+password and return the user (or null). */
export async function authenticateUser(username, password) {
  const { getUserByUsername } = await import("@/lib/db/repos/usersRepo.js");
  const u = await getUserByUsername(username);
  if (!u || !u.isActive) return null;
  if (!(await verifyUserPassword(u, password))) return null;
  return u;
}
