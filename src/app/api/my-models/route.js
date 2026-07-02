import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/authContext";
import { getUserById } from "@/lib/db/repos/usersRepo.js";
import { buildSelectableModels } from "@/lib/selectableModels";
import { globToRegExp } from "@/lib/auth/apiKeyScope.js";

export const dynamic = "force-dynamic";

// GET /api/my-models — the logged-in user's ALLOWED models (resolved against the
// global selectable model list). If the user has no allowedModels whitelist →
// returns { unlimited: true } (all models allowed).
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = ctx.userId ? await getUserById(ctx.userId) : null;
  const allowed = user?.allowedModels;

  // Build the global model list directly (no self-fetch — breaks behind proxies).
  const global = await buildSelectableModels().catch(() => ({ groups: [], combos: [] }));

  if (!Array.isArray(allowed) || allowed.length === 0) {
    return NextResponse.json({ unlimited: true, ...global });
  }

  // allowed entries may be globs (e.g. "openai/*") or exact model values.
  const patterns = allowed.map((p) => globToRegExp(p));
  const matches = (value) => patterns.some((re) => re.test(value));

  const groups = (global.groups || [])
    .map((g) => ({ ...g, models: (g.models || []).filter((m) => matches(m.value)) }))
    .filter((g) => g.models.length > 0);

  const combos = (global.combos || []).filter((c) => matches(c.value || c.id));

  return NextResponse.json({ unlimited: false, allowedCount: allowed.length, groups, combos });
}
