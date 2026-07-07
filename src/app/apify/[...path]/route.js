import { proxyToApify } from "@/lib/apify/client.js";

export const dynamic = "force-dynamic";

/**
 * Catch-all proxy: /apify/v2/[...path]
 * Forwards any request to https://api.apify.com/v2/[...path]
 * with round-robin API key injection.
 */
async function handler(request, { params }) {
  const { path } = await params;
  const apifyPath = path.join("/");

  // Build search params from URL
  const url = new URL(request.url);
  const searchParams = {};
  for (const [key, value] of url.searchParams.entries()) {
    searchParams[key] = value;
  }

  // Build body for non-GET/HEAD requests
  let body = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        body = await request.json();
      } else {
        body = await request.text();
      }
    } catch {
      // Empty body
    }
  }

  try {
    const response = await proxyToApify(apifyPath, {
      method: request.method,
      body,
      searchParams,
    });

    // Stream the response back
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Apify proxy error" },
      { status: 502 }
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
