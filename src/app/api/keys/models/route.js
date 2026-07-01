import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getModelAliases, getCombos } from "@/models";
import { getProviderNodes } from "@/lib/db/repos/nodesRepo.js";
import { getCustomModels } from "@/lib/db/repos/aliasRepo.js";
import { getDisabledModels } from "@/lib/db/repos/disabledModelsRepo.js";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

// Provider order: OAuth first, then Free, then Free Tier, then API Key (matches dashboard).
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth);

/**
 * Build the full list of selectable models (for API-key "Allowed Models" checkbox UI),
 * grouped by provider. Mirrors the grouping logic of ModelSelectModal but LLM-focused
 * (chat/embedding targets). Combos are returned separately.
 */
export async function GET() {
  try {
    const [connections, modelAliases, combos, providerNodes, customModels, disabledModels] = await Promise.all([
      getProviderConnections({ isActive: true }),
      getModelAliases(),
      getCombos(),
      getProviderNodes(),
      getCustomModels(),
      getDisabledModels(),
    ]);

    const activeIds = new Set(connections.map((c) => c.provider));
    const noAuthIds = NO_AUTH_PROVIDER_IDS;
    const providerIdsToShow = new Set([...activeIds, ...noAuthIds]);
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const ia = PROVIDER_ORDER.indexOf(a);
      const ib = PROVIDER_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const groups = [];

    for (const providerId of sortedProviderIds) {
      const alias = getProviderAlias(providerId);
      const providerInfo = AI_PROVIDERS[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
      const matchedNode = providerNodes.find((n) => n.id === providerId);
      const connection = connections.find((c) => c.provider === providerId);
      const displayName = matchedNode?.name || connection?.name || providerInfo.name;

      let models = [];

      if (isCustomProvider) {
        // Compatible providers: list aliases + custom-registered models under this provider.
        const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;
        const aliasModels = Object.entries(modelAliases)
          .filter(([, full]) => full.startsWith(`${providerId}/`))
          .map(([aliasName, full]) => ({
            id: full.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${full.replace(`${providerId}/`, "")}`,
          }));
        const registeredCustom = customModels
          .filter((m) => m.providerAlias === providerId)
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}`, isCustom: true }));
        const seen = new Set(aliasModels.map((m) => m.value));
        models = [...aliasModels, ...registeredCustom.filter((m) => !seen.has(m.value))];
      } else {
        const hardcoded = getModelsByProviderId(providerId)
          .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
          .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}` }));
        const hardcodedIds = new Set(hardcoded.map((m) => m.id));
        // Aliases (user-renamed models) for this provider
        const aliasModels = Object.entries(modelAliases)
          .filter(([, full]) => full.startsWith(`${alias}/`))
          .map(([aliasName, full]) => {
            const modelId = full.replace(`${alias}/`, "");
            return { id: modelId, name: aliasName, value: full, isCustom: !hardcodedIds.has(modelId) };
          });
        // Custom-registered models via /api/models/custom
        const registeredCustom = customModels
          .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id))
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));
        const seen = new Set();
        models = [...hardcoded, ...aliasModels, ...registeredCustom].filter((m) => {
          if (seen.has(m.value)) return false;
          seen.add(m.value);
          return true;
        });
      }

      if (models.length === 0) continue;

      // Drop disabled models.
      const disabledIds = new Set([...(disabledModels[alias] || []), ...(disabledModels[providerId] || [])]);
      if (disabledIds.size > 0) {
        models = models.filter((m) => !disabledIds.has(m.id));
        if (models.length === 0) continue;
      }

      groups.push({
        providerId,
        name: displayName,
        color: providerInfo.color || "#666",
        models: models.map((m) => ({ id: m.id, name: m.name, value: m.value, isCustom: !!m.isCustom })),
      });
    }

    return NextResponse.json({
      groups,
      combos: (combos || []).map((c) => ({ id: c.id, name: c.name, value: c.name })),
    });
  } catch (error) {
    console.log("Error fetching selectable models:", error);
    return NextResponse.json({ error: "Failed to fetch selectable models" }, { status: 500 });
  }
}
