import { NextResponse } from "next/server";
import { getApifyKeys } from "@/lib/db/repos/apifyKeysRepo.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/apify/account
 * Fetches account info (plan, usage, balance) for all Apify keys.
 * Calls GET https://api.apify.com/v2/users/me for each key.
 */
export async function GET() {
  try {
    const keys = await getApifyKeys({ isActive: true });
    if (keys.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    const accounts = await Promise.all(
      keys.map(async (key) => {
        try {
          const res = await fetch("https://api.apify.com/v2/users/me", {
            headers: { Authorization: `Bearer ${key.token}` },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            return {
              id: key.id,
              name: key.name,
              error: `HTTP ${res.status}`,
              plan: null,
              usage: null,
            };
          }
          const { data } = await res.json();

          // Flatten plan object → string + extract limits
          const planObj = data.plan || {};
          const planId = (planObj.id || planObj.tier || "free").toLowerCase();

          return {
            id: key.id,
            name: key.name,
            username: data.username,
            email: data.email,
            plan: planId,
            planUsage: {
              maxMonthlyUsageUsd: planObj.maxMonthlyUsageUsd || 0,
              monthlyUsageCreditsUsd: planObj.monthlyUsageCreditsUsd || 0,
              maxMonthlyActorComputeUnits: planObj.maxMonthlyActorComputeUnits || 0,
              maxMonthlyResidentialProxyGbytes: planObj.maxMonthlyResidentialProxyGbytes || 0,
              maxMonthlyProxySerps: planObj.maxMonthlyProxySerps || 0,
              dataRetentionDays: planObj.dataRetentionDays || 0,
              maxConcurrentActorRuns: planObj.maxConcurrentActorRuns || 0,
            },
            usage: data.usage || {},
            proxyUnlimited: data.proxyUnlimited || false,
            profile: data.profile || {},
          };
        } catch (error) {
          return {
            id: key.id,
            name: key.name,
            error: error.message,
            plan: null,
            usage: null,
          };
        }
      })
    );

    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
