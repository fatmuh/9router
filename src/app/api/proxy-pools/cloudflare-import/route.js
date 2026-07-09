import { NextResponse } from "next/server";
import { createProxyPool, getProxyPools } from "@/models";

// GET /api/proxy-pools/cloudflare-import — list existing CF workers
// POST /api/proxy-pools/cloudflare-import — bulk import selected workers
//
// Query params (GET) / body (POST):
//   accountId  — CF account ID (required)
//   apiToken   — CF API token with Workers Scripts: Read + Edit (required)
//   names      — (POST only) comma-separated worker names to import; omit = import all

async function fetchWorkerList(accountId, apiToken) {
  // Fetch all worker scripts on the account
  const scriptsUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts?per_page=100`;
  const scriptsRes = await fetch(scriptsUrl, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!scriptsRes.ok) {
    const err = await scriptsRes.json().catch(() => ({}));
    const msg = err.errors?.[0]?.message || "Failed to list Cloudflare Workers";
    return { error: msg, status: scriptsRes.status };
  }

  const scriptsData = await scriptsRes.json();
  const scripts = scriptsData.result || [];

  // Get workers.dev subdomain to build URLs
  let subdomain = "";
  const subdomainRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (subdomainRes.ok) {
    const subdomainData = await subdomainRes.json();
    subdomain = subdomainData.result?.subdomain || "";
  }

  // Map scripts to a simple shape with constructed URL
  const workers = scripts.map((script) => {
    const name = script.id || script.name || "";
    const url = subdomain ? `https://${name}.${subdomain}.workers.dev` : "";
    return {
      name,
      url,
      createdOn: script.created_on || null,
      modifiedOn: script.modified_on || null,
      usageModel: script.usage_model || null,
    };
  });

  return { workers, subdomain };
}

// GET — list workers (preview before import)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId")?.trim();
    const apiToken = searchParams.get("apiToken")?.trim();

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: "Account ID and API Token are required" },
        { status: 400 }
      );
    }

    const result = await fetchWorkerList(accountId, apiToken);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      workers: result.workers,
      subdomain: result.subdomain,
      total: result.workers.length,
    });
  } catch (error) {
    console.log("Error listing Cloudflare workers:", error);
    return NextResponse.json({ error: error.message || "Failed to list workers" }, { status: 500 });
  }
}

// POST — bulk import selected workers as proxy pools
export async function POST(request) {
  try {
    const body = await request.json();
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    const namesFilter = typeof body.names === "string"
      ? body.names.split(",").map((n) => n.trim()).filter(Boolean)
      : null;

    if (!accountId || !apiToken) {
      return NextResponse.json(
        { error: "Account ID and API Token are required" },
        { status: 400 }
      );
    }

    const result = await fetchWorkerList(accountId, apiToken);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Filter to requested names if provided
    const toImport = namesFilter
      ? result.workers.filter((w) => namesFilter.includes(w.name))
      : result.workers;

    if (toImport.length === 0) {
      return NextResponse.json(
        { error: "No matching workers found to import" },
        { status: 404 }
      );
    }

    // Get existing pools for deduplication
    const existingPools = await getProxyPools();
    const existingUrls = new Set(existingPools.map((p) => (p.proxyUrl || "").trim()));

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const imported = [];
    const errors = [];

    for (const worker of toImport) {
      if (!worker.url) {
        skipped += 1;
        errors.push(`${worker.name}: no workers.dev subdomain — cannot construct URL`);
        continue;
      }

      // Dedupe by URL
      if (existingUrls.has(worker.url)) {
        skipped += 1;
        continue;
      }

      try {
        const pool = await createProxyPool({
          name: worker.name,
          proxyUrl: worker.url,
          type: "cloudflare",
          noProxy: "",
          isActive: true,
          strictProxy: false,
        });
        imported.push(pool);
        existingUrls.add(worker.url);
        created += 1;
      } catch (e) {
        failed += 1;
        errors.push(`${worker.name}: ${e.message}`);
      }
    }

    return NextResponse.json({
      created,
      skipped,
      failed,
      imported,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 201 });
  } catch (error) {
    console.log("Error importing Cloudflare workers:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500 });
  }
}
