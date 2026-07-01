import { NextResponse } from "next/server";
import { getRoles, createRole } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.permissions.has("roles.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ roles: await getRoles() });
}

export async function POST(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.permissions.has("roles.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { name, description, permissions } = await request.json();
    const role = await createRole({ name, description, permissions });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
