import { NextResponse } from "next/server";
import { setUserPassword } from "@/lib/localDb";
import { getAuthContext } from "@/lib/auth/authContext";

export async function POST(request, { params }) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // User manager can reset anyone; users can reset their own.
  const canManage = ctx.permissions.has("users.manage") || ctx.userId === id;
  if (!canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { password } = await request.json();
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    await setUserPassword(id, password);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
