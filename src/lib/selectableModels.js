// Shared model-list builder. Used by /api/keys/models (picker UI) and
// /api/my-models (filtered by the user's allowedModels whitelist).
// Extracted so neither route needs to self-fetch the other (which breaks behind
// reverse proxies / tunnels where the public origin is https but the internal
// app is http).
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

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth);

/**
 * Build the full list of selectable models grouped by provider (LLM-focused),
 * plus combos. Mirrors the original /api/keys/models GET logic.
 * @returns {Promise<{ groups: Array, combos: Array }>}
 */
export async function buildSelectableModels() {
  const [connections, modelAliases, combos, providerNodes, customModels, disabledModels] = await Promise.all([
    getProviderConnections({ isActive: true }),
    getModelAliases(),
    getCombos(),
    getProviderNodes(),
    getCustomModels(),
    getDisabledModels(),
  ]);

  const activeIds = new Set(connections.map((c) => c.provider));
  const providerIdsToShow = new Set([...activeIds, ...NO_AUTH_PROVIDER_IDS]);
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
    // Group header: built-in providers show their canonical name (e.g. "OpenAI"),
    // custom/compatible nodes show the user-defined node name. Never the OAuth email.
    const displayName = isCustomProvider
      ? (matchedNode?.name || providerInfo.name)
      : providerInfo.name;

    let models = [];

    if (isCustomProvider) {
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
      const aliasModels = Object.entries(modelAliases)
        .filter(([, full]) => full.startsWith(`${alias}/`))
        .map(([aliasName, full]) => {
          const modelId = full.replace(`${alias}/`, "");
          return { id: modelId, name: aliasName, value: full, isCustom: !hardcodedIds.has(modelId) };
        });
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

    const disabledIds = new Set([...(disabledModels[alias] || []), ...(disabledModels[providerId] || [])]);
    if (disabledIds.size > 0) {
      models = models.filter((m) => !disabledIds.has(m.id));
      if (models.length === 0) continue;
    }

    const iconPath = isCustomProvider
      ? (isAnthropicCompatibleProvider(providerId) ? "/providers/anthropic-m.png" : "/providers/oai-cc.png")
      : `/providers/${providerId}.png`;

    groups.push({
      providerId,
      name: displayName,
      color: providerInfo.color || "#666",
      icon: iconPath,
      models: models.map((m) => ({ id: m.id, name: m.name, value: m.value, isCustom: !!m.isCustom })),
    });
  }

  return {
    groups,
    combos: (combos || []).map((c) => ({ id: c.id, name: c.name, value: c.name })),
  };
}
