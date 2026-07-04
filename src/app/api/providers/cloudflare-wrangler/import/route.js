import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  deleteProviderConnection,
} from "@/models";

export const dynamic = "force-dynamic";

// POST /api/providers/cloudflare-wrangler/import
// Body: { urls: ["https://worker1.workers.dev", "https://worker2.workers.dev"] }
//   or: { urls: [{ url: "https://worker1.workers.dev", name: "Worker 1" }] }
//
// Replace all existing cloudflare-wrangler connections with new ones.
// Old connections are deleted, new ones are created.
export async function POST(request) {
  try {
    const body = await request.json();
    const { urls } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Normalize URLs
    const normalizedUrls = urls.map((item, index) => {
      if (typeof item === "string") {
        return {
          url: item.trim().replace(/\/$/, ""),
          name: `Wrangler Worker ${index + 1}`,
        };
      }
      if (item && typeof item === "object" && item.url) {
        return {
          url: item.url.trim().replace(/\/$/, ""),
          name: item.name || `Wrangler Worker ${index + 1}`,
        };
      }
      return null;
    }).filter(Boolean);

    if (normalizedUrls.length === 0) {
      return NextResponse.json(
        { error: "No valid URLs provided" },
        { status: 400 }
      );
    }

    // Get all existing cloudflare-wrangler connections
    const allConnections = await getProviderConnections();
    const existingConnections = allConnections.filter(
      (c) => c.provider === "cloudflare-wrangler"
    );

    // Delete all existing connections
    let deletedCount = 0;
    for (const conn of existingConnections) {
      try {
        await deleteProviderConnection(conn.id);
        deletedCount++;
      } catch (error) {
        console.log(`Error deleting connection ${conn.id}:`, error);
      }
    }

    // Create new connections
    const created = [];
    const errors = [];

    for (const { url, name } of normalizedUrls) {
      try {
        const newConnection = await createProviderConnection({
          provider: "cloudflare-wrangler",
          authType: "apikey",
          name,
          apiKey: "", // No API key needed
          priority: 1,
          providerSpecificData: {
            baseUrl: url,
            workerUrl: url,
          },
          isActive: true,
          testStatus: "unknown",
        });
        created.push({
          id: newConnection.id,
          name: newConnection.name,
          url,
        });
      } catch (error) {
        errors.push({ url, name, error: error.message });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        deleted: deletedCount,
        created: created.length,
        failed: errors.length,
        total: normalizedUrls.length,
      },
      connections: created,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.log("Error importing cloudflare-wrangler:", error);
    return NextResponse.json(
      { error: "Failed to import workers" },
      { status: 500 }
    );
  }
}

// GET /api/providers/cloudflare-wrangler/import
// Get current cloudflare-wrangler connections
export async function GET() {
  try {
    const allConnections = await getProviderConnections();
    const connections = allConnections
      .filter((c) => c.provider === "cloudflare-wrangler")
      .map((c) => ({
        id: c.id,
        name: c.name,
        url: c.providerSpecificData?.baseUrl || c.providerSpecificData?.workerUrl || "",
        isActive: c.isActive,
        testStatus: c.testStatus,
        lastError: c.lastError,
      }));

    return NextResponse.json({
      count: connections.length,
      connections,
    });
  } catch (error) {
    console.log("Error fetching cloudflare-wrangler connections:", error);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
