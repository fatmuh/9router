import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  deleteProviderConnection,
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

// POST /api/providers/cloudflare-wrangler/add
// Add new workers WITHOUT deleting existing ones (append mode)
// Body: { urls: ["https://worker1.workers.dev", ...] }
export async function POST(request) {
  try {
    const auth = await validateApiKey(request);
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }
    
    const body = await request.json();
    const { urls } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "urls array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Get existing URLs to avoid duplicates
    const allConnections = await getProviderConnections();
    const existingUrls = new Set(
      allConnections
        .filter((c) => c.provider === "cloudflare-wrangler")
        .map((c) => c.providerSpecificData?.baseUrl || c.providerSpecificData?.workerUrl || "")
    );

    // Normalize and filter new URLs
    const newUrls = urls
      .map((item) => {
        if (typeof item === "string") return item.trim().replace(/\/$/, "");
        if (item && typeof item === "object" && item.url) return item.url.trim().replace(/\/$/, "");
        return null;
      })
      .filter((url) => url && !existingUrls.has(url));

    if (newUrls.length === 0) {
      return NextResponse.json({
        success: true,
        summary: { added: 0, skipped: urls.length, total: existingUrls.size },
        message: "All URLs already exist or no valid URLs provided",
      });
    }

    // Add new connections (append, don't delete)
    const created = [];
    const errors = [];
    const nextIndex = existingUrls.size + 1;

    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      try {
        const newConnection = await createProviderConnection({
          provider: "cloudflare-wrangler",
          authType: "apikey",
          name: `Wrangler Worker ${nextIndex + i}`,
          apiKey: "",
          priority: 1,
          providerSpecificData: {
            baseUrl: url,
            workerUrl: url,
            createdAt: new Date().toISOString(),
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
        errors.push({ url, error: error.message });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        added: created.length,
        skipped: existingUrls.size,
        failed: errors.length,
        total: existingUrls.size + created.length,
      },
      connections: created,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.log("Error adding cloudflare-wrangler workers:", error);
    return NextResponse.json(
      { error: "Failed to add workers" },
      { status: 500 }
    );
  }
}
