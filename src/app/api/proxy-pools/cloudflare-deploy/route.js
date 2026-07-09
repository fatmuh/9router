import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";

// Relay worker source code deployed to Cloudflare
const RELAY_WORKER_CODE = `
export default {
  async fetch(request, env, ctx) {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;

async function deploySingleWorker(accountId, apiToken, projectName) {
  // 1. Upload Worker Script
  const workerScriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${projectName}`;

  const formData = new FormData();
  formData.append("index.js", new Blob([RELAY_WORKER_CODE], { type: "application/javascript+module" }), "index.js");
  formData.append("metadata", new Blob([JSON.stringify({
    main_module: "index.js",
    compatibility_date: "2024-03-20",
    observability: { enabled: true }
  })], { type: "application/json" }), "metadata.json");

  const uploadRes = await fetch(workerScriptUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    return { error: err.errors?.[0]?.message || `Failed to upload Worker (${uploadRes.status})` };
  }

  // 2. Enable workers.dev subdomain for the script
  await fetch(`${workerScriptUrl}/subdomain`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: true }),
  }).catch(() => {});

  // 3. Get the workers.dev subdomain for the account
  let deployUrl = "";
  const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });

  if (subdomainRes.ok) {
    const subdomainData = await subdomainRes.json();
    if (subdomainData.result?.subdomain) {
      deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
    }
  }

  if (!deployUrl) {
    return { error: "Worker uploaded but failed to retrieve workers.dev subdomain." };
  }

  return { deployUrl };
}

// POST /api/proxy-pools/cloudflare-deploy
// Single:   { accountId, apiToken, projectName }
// Bulk:     { bulk: true, items: [{ accountId, apiToken, projectName? }, ...] }
export async function POST(request) {
  try {
    const body = await request.json();

    // ===== BULK MODE =====
    if (body.bulk === true && Array.isArray(body.items)) {
      const stamp = Date.now().toString(36);
      let created = 0;
      let failed = 0;
      const results = [];

      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        const accountId = item.accountId?.trim();
        const apiToken = item.apiToken?.trim();
        const projectName = (item.projectName?.trim() || `relay-${stamp}-${i + 1}`);

        if (!accountId || !apiToken) {
          failed++;
          results.push({ index: i + 1, error: "Missing accountId or apiToken" });
          continue;
        }

        const deploy = await deploySingleWorker(accountId, apiToken, projectName);
        if (deploy.error) {
          failed++;
          results.push({ index: i + 1, projectName, error: deploy.error });
          continue;
        }

        try {
          const pool = await createProxyPool({
            name: projectName,
            proxyUrl: deploy.deployUrl,
            type: "cloudflare",
            noProxy: "",
            isActive: true,
            strictProxy: false,
          });
          created++;
          results.push({ index: i + 1, projectName, deployUrl: deploy.deployUrl, poolId: pool.id });
        } catch (e) {
          failed++;
          results.push({ index: i + 1, projectName, error: e.message });
        }
      }

      return NextResponse.json({ created, failed, results }, { status: 201 });
    }

    // ===== SINGLE MODE (original) =====
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare Account ID and API Token are required" }, { status: 400 });
    }

    const deploy = await deploySingleWorker(accountId, apiToken, projectName);
    if (deploy.error) {
      return NextResponse.json({ error: deploy.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deploy.deployUrl,
      type: "cloudflare",
      noProxy: "",
      isActive: true,
      strictProxy: false,
    });

    return NextResponse.json({ proxyPool, deployUrl: deploy.deployUrl }, { status: 201 });
  } catch (error) {
    console.log("Error deploying Cloudflare relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
