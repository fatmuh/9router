import { NextResponse } from "next/server";
import {
  createProviderConnection,
  createProviderNode,
  getProviderNodes,
} from "@/lib/localDb";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

// POST /api/providers/import
// Body: { nodes?: [...], connections?: [...] }  (the same shape produced by /export)
//       or an array of connections (lenient).
//
// Bulk-imports provider nodes + connections. Idempotent-ish:
//  - nodes upsert by id (prefix stays stable)
//  - connections go through createProviderConnection which dedups by name/email
export async function POST(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx, "providers.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept either { nodes, connections } or a bare array of connections.
  let nodes = [];
  let connections = [];
  if (Array.isArray(body)) {
    connections = body;
  } else {
    nodes = Array.isArray(body.nodes) ? body.nodes : [];
    connections = Array.isArray(body.connections) ? body.connections : [];
  }

  if (nodes.length === 0 && connections.length === 0) {
    return NextResponse.json(
      { error: "No nodes or connections found in import payload" },
      { status: 400 }
    );
  }

  const existingNodes = await getProviderNodes();
  const existingNodeIds = new Set(existingNodes.map((n) => n.id));

  // 1. Import nodes first (custom providers must exist before their connections).
  let nodesImported = 0;
  let nodesSkipped = 0;
  for (const n of nodes) {
    if (!n || (!n.id && !n.prefix)) { nodesSkipped++; continue; }
    try {
      // createProviderNode upserts by id — preserves prefix routing.
      await createProviderNode({
        id: n.id,
        type: n.type,
        name: n.name,
        prefix: n.prefix,
        apiType: n.apiType,
        baseUrl: n.baseUrl,
        ...n, // pass through any extra data fields
      });
      nodesImported++;
    } catch {
      nodesSkipped++;
    }
  }

  // 2. Import connections.
  let connsImported = 0;
  let connsSkipped = 0;
  const errors = [];
  for (const c of connections) {
    if (!c || !c.provider) { connsSkipped++; continue; }
    try {
      // createProviderConnection dedups internally (apikey→name, oauth→email).
      await createProviderConnection({
        provider: c.provider,
        authType: c.authType || "apikey",
        name: c.name,
        email: c.email,
        priority: c.priority,
        isActive: c.isActive !== undefined ? c.isActive : true,
        apiKey: c.apiKey,
        accessToken: c.accessToken,
        refreshToken: c.refreshToken,
        expiresAt: c.expiresAt,
        tokenType: c.tokenType,
        scope: c.scope,
        projectId: c.projectId,
        providerSpecificData: c.providerSpecificData,
        ...c, // pass through any extra optional fields
      });
      connsImported++;
    } catch (e) {
      connsSkipped++;
      errors.push({ provider: c.provider, name: c.name, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      nodes: { imported: nodesImported, skipped: nodesSkipped, total: nodes.length },
      connections: { imported: connsImported, skipped: connsSkipped, total: connections.length },
    },
    errors: errors.slice(0, 20),
  });
}
