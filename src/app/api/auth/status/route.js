import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getAuthContext } from "@/lib/auth/authContext";

export async function GET() {
  try {
    const settings = await getSettings();
    const ctx = await getAuthContext();
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";

    if (!ctx) {
      return NextResponse.json({
        requireLogin,
        authMode,
        oidcConfigured: isOidcConfigured(settings),
        oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
        authenticated: false,
      });
    }

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      authenticated: true,
      userId: ctx.userId,
      username: ctx.username,
      roleName: ctx.roleName,
      roleId: ctx.roleId,
      permissions: [...ctx.permissions],
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      authenticated: false,
    });
  }
}
