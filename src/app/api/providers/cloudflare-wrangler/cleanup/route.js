import { NextResponse } from "next/server";
import {
  getProviderConnections,
  deleteProviderConnection,
  updateProviderConnection,
} from "@/models";
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";

export const dynamic = "force-dynamic";

// Validate API key
async function validateApiKey(request) {
  const authHeader = request.headers.get("authorization");
  let apiKey = null;
  
  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7).trim();
  }
  
  if (!apiKey) {
    const { searchParams } = new URL(request.url);
    apiKey = searchParams.get("api_key") || searchParams.get("apiKey");
  }
  
  if (!apiKey) {
    return { valid: false, error: "API key required" };
  }
  
  const keyRecord = await getApiKeyByKey(apiKey);
  if (!keyRecord) {
    return { valid: false, error: "Invalid API key" };
  }
  if (!keyRecord.isActive) {
    return { valid: false, error: "API key is disabled" };
  }
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
    return { valid: false, error: "API key has expired" };
  }
  
  return { valid: true, keyRecord };
}

// Check if a worker is alive (health check)
async function checkWorkerHealth(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// POST /api/providers/cloudflare-wrangler/cleanup
// Delete expired/dead workers (health check fails)
// Body: { dry_run?: boolean, timeout?: number }
export async function POST(request) {
  try {
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }
    
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const timeout = body.timeout || 5000;

    // Get all cloudflare-wrangler connections
    const allConnections = await getProviderConnections();
    const cfConnections = allConnections.filter(
      (c) => c.provider === "cloudflare-wrangler"
    );

    if (cfConnections.length === 0) {
      return NextResponse.json({
        success: true,
        summary: { checked: 0, alive: 0, dead: 0, deleted: 0 },
        message: "No cloudflare-wrangler connections found",
      });
    }

    // Check health of all workers in parallel (batch of 10)
    const results = [];
    const batchSize = 10;
    
    for (let i = 0; i < cfConnections.length; i += batchSize) {
      const batch = cfConnections.slice(i, i + batchSize);
      const checks = await Promise.all(
        batch.map(async (conn) => {
          const url = conn.providerSpecificData?.baseUrl || conn.providerSpecificData?.workerUrl || "";
          const alive = await checkWorkerHealth(url, timeout);
          return { conn, url, alive };
        })
      );
      results.push(...checks);
    }

    const alive = results.filter((r) => r.alive);
    const dead = results.filter((r) => !r.alive);

    // Delete dead workers
    let deletedCount = 0;
    const deletedWorkers = [];
    
    if (!dryRun) {
      for (const { conn, url } of dead) {
        try {
          await deleteProviderConnection(conn.id);
          deletedCount++;
          deletedWorkers.push({ id: conn.id, url });
        } catch (error) {
          console.log(`Error deleting connection ${conn.id}:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        checked: cfConnections.length,
        alive: alive.length,
        dead: dead.length,
        deleted: dryRun ? 0 : deletedCount,
        dry_run: dryRun,
      },
      dead_workers: dead.map((r) => ({
        id: r.conn.id,
        url: r.url,
        deleted: dryRun ? false : true,
      })),
    });
  } catch (error) {
    console.log("Error cleaning up cloudflare-wrangler:", error);
    return NextResponse.json(
      { error: "Failed to cleanup workers" },
      { status: 500 }
    );
  }
}

// GET /api/providers/cloudflare-wrangler/cleanup
// Quick status: count alive vs dead
export async function GET(request) {
  try {
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const allConnections = await getProviderConnections();
    const cfConnections = allConnections.filter(
      (c) => c.provider === "cloudflare-wrangler"
    );

    return NextResponse.json({
      total: cfConnections.length,
      connections: cfConnections.map((c) => ({
        id: c.id,
        url: c.providerSpecificData?.baseUrl || c.providerSpecificData?.workerUrl || "",
        isActive: c.isActive,
        createdAt: c.providerSpecificData?.createdAt,
      })),
    });
  } catch (error) {
    console.log("Error fetching cloudflare-wrangler status:", error);
    return NextResponse.json(
      { error: "Failed to fetch status" },
      { status: 500 }
    );
  }
}
