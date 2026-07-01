import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeOidcCode,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
  pickOidcDisplayName,
  pickOidcEmail,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { getUserByOidcSubject } from "@/lib/db/repos/usersRepo.js";
import { getRoleById } from "@/lib/db/repos/rolesRepo.js";
import { touchUserLogin } from "@/lib/localDb";

function clearOidcCookies(cookieStore) {
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
}

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, getPublicOrigin(request)));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=oidc_missing_code", getPublicOrigin(request)));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oidc_state")?.value;
  const storedNonce = cookieStore.get("oidc_nonce")?.value;
  const codeVerifier = cookieStore.get("oidc_code_verifier")?.value;

  if (!storedState || !storedNonce || !codeVerifier || storedState !== state) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL("/login?error=oidc_invalid_state", getPublicOrigin(request)));
  }

  try {
    const config = await getOidcRuntimeConfig();
    if (!config) {
      clearOidcCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const discoveredIssuer = discovery.issuer || config.issuerUrl;
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const tokenData = await exchangeOidcCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!tokenData.id_token) {
      throw new Error("OIDC provider did not return an id_token");
    }

    const payload = await verifyOidcIdToken({
      idToken: tokenData.id_token,
      issuer: discoveredIssuer,
      audience: config.clientId,
      jwksUri: discovery.jwks_uri,
      nonce: storedNonce,
    });

    clearOidcCookies(cookieStore);

    // ── RBAC: only pre-registered users (linked via oidcSubject) may log in via OIDC. ──
    // Unknown OIDC identities are rejected — they must be registered by an admin first.
    // Match against the `sub` claim OR the email (admins typically enter the email,
    // which is easier to know than the opaque provider-specific `sub`).
    const oidcSub = payload.sub || null;
    const oidcEmail = pickOidcEmail(payload) || null;
    if (!oidcSub) {
      return NextResponse.redirect(new URL("/login?error=oidc_no_subject", getPublicOrigin(request)));
    }

    let user = oidcSub ? await getUserByOidcSubject(oidcSub) : null;
    if (!user && oidcEmail) {
      // Fallback: admin may have registered the email as the subject.
      user = await getUserByOidcSubject(oidcEmail);
    }
    if (!user) {
      const hint = oidcEmail ? ` (${oidcEmail})` : "";
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(`OIDC identity${hint} is not registered. Ask an admin to add your account with sub or email as the OIDC subject.`)}`, getPublicOrigin(request))
      );
    }
    if (!user.isActive) {
      return NextResponse.redirect(new URL("/login?error=account_paused", getPublicOrigin(request)));
    }

    await touchUserLogin(user.id);
    const role = await getRoleById(user.roleId);

    // Issue the SAME RBAC JWT as password login (carries userId/roleId → real permissions).
    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      username: user.username,
      roleId: user.roleId,
      roleName: role?.name || null,
      // keep OIDC provenance for auditing
      oidc: true,
      oidcSub,
      oidcEmail,
      oidcName: pickOidcDisplayName(payload),
    });

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_callback_failed")}`, getPublicOrigin(request)));
  }
}
