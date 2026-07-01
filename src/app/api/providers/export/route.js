import { NextResponse } from "next/server";
import { getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { getAuthContext, hasPermission } from "@/lib/auth/authContext";

export const dynamic = "force-dynamic";

// GET /api/providers/export          → export ALL connections + nodes
// GET /api/providers/export?provider=X → export a single provider (its connections + its node if custom)
//
// Returns a JSON file. The "nodes" array contains custom-provider definitions
// (OpenAI/Anthropic compatible, custom embeddings). The "connections" array
// contains the credential rows. Built-in providers (openai, anthropic, …) only
// produce connections — no node entry.
export async function GET(request) {
  const ctx = await getAuthContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(ctx, "providers.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const providerFilter = searchParams.get("provider"); // null = all

  let connections = await getProviderConnections();
  let nodes = await getProviderNodes();

  if (providerFilter) {
    connections = connections.filter((c) => c.provider === providerFilter);
    // Include the node only if this provider IS a custom node (id matches).
    nodes = nodes.filter((n) => n.id === providerFilter);
  }

  // Strip volatile/internal bookkeeping fields so re-import is clean.
  const cleanConn = (c) => {
    const {
      // keep: provider, authType, name, email, priority, isActive,
      //       providerSpecificData, apiKey, accessToken, refreshToken, ...
      lastError, lastErrorAt, lastTested, testStatus, rateLimitedUntil,
      consecutiveUseCount, errorCode, createdAt, updatedAt, id,
      ...rest
    } = c;
    return {
      provider: c.provider,
      authType: c.authType,
      name: c.name,
      email: c.email,
      priority: c.priority,
      isActive: c.isActive,
      ...rest,
    };
  };

  const cleanNode = (n) => {
    const { id, createdAt, updatedAt, ...rest } = n;
    return { id, ...rest }; // keep node id (prefix routing depends on it)
  };

  const payload = {
    version: 1,
    app: "9router",
    exportedAt: new Date().toISOString(),
    exportedBy: ctx.username || "unknown",
    scope: providerFilter || "all",
    nodes: nodes.map(cleanNode),
    connections: connections.map(cleanConn),
  };

  const fname = providerFilter
    ? `9router-provider-${providerFilter}.json`
    : `9router-providers-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
