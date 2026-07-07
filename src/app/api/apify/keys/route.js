import { NextResponse } from "next/server";
import { getApifyKeys, createApifyKey, deleteApifyKey, updateApifyKey } from "@/lib/db/repos/apifyKeysRepo.js";
import { getKeyStatus } from "@/lib/apify/client.js";

export const dynamic = "force-dynamic";

// GET /api/apify/keys — list all keys (with masked tokens)
export async function GET() {
  try {
    const keys = await getKeyStatus();
    return NextResponse.json({ keys });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/apify/keys — add new key(s)
// Body: { token: "apify-api-xxx" } or { tokens: ["apify-api-xxx", "apify-api-yyy"] }
// Or: { name: "Account 1", tokens: [...] }
export async function POST(request) {
  try {
    const body = await request.json();
    const { token, tokens, name } = body;

    // Bulk add
    if (Array.isArray(tokens) && tokens.length > 0) {
      const created = [];
      const errors = [];
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]?.trim();
        if (!t) continue;
        try {
          const key = await createApifyKey({
            token: t,
            name: name || `Apify Account ${i + 1}`,
          });
          created.push({ id: key.id, name: key.name, tokenPreview: `${t.substring(0, 8)}...` });
        } catch (error) {
          errors.push({ token: `${t.substring(0, 8)}...`, error: error.message });
        }
      }
      return NextResponse.json({ success: true, created: created.length, errors, keys: created });
    }

    // Single add
    if (!token) {
      return NextResponse.json({ error: "token or tokens array required" }, { status: 400 });
    }

    const key = await createApifyKey({
      token: token.trim(),
      name: name || null,
    });

    return NextResponse.json({
      success: true,
      key: { id: key.id, name: key.name, tokenPreview: `${token.trim().substring(0, 8)}...` },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/apify/keys?id=xxx
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const removed = await deleteApifyKey(id);
    if (!removed) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/apify/keys — update key (toggle active, rename)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const updated = await updateApifyKey(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, key: updated });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
