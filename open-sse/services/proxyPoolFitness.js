// Durable proxy-pool fitness registry (in-memory adaptation for the 9Router fork).
// Scope format: `provider::model` (for example `freebuff::openai/gpt-5`).
//
// NOTE: The upstream VansRouter version of this module persists fitness rows to
// a SQLite `proxy_pool_fitness` table via @/models (listProxyPoolFitness,
// upsertProxyPoolFitness, deleteProxyPoolFitness, clearProxyPoolFitness). The
// 9Router fork's @/models surface does not yet expose those repos, so this
// adaptation keeps the SAME exported API but backs it with a single in-memory
// globalThis map. Runtime behaviour — marking a pool unfit for a
// provider::model scope so the caller retries via another pool, and lifting the
// mark once the pair is healthy again — is identical; only cross-restart
// durability is lost. Every former DB call is fail-open (returns a sensible
// default instead of throwing), matching the upstream contract. Wiring up the
// SQLite repo later is a drop-in if @/models gains the fitness table.

const FITNESS_STATE_KEY = "__9routerPoolFitness__";
const fitness = (globalThis[FITNESS_STATE_KEY] ??= new Map());

export const POOL_UNFIT_MS = 5 * 60 * 1000;

function entriesFromMap(poolId) {
  const byScope = fitness.get(poolId);
  return byScope ? [...byScope.entries()].map(([scope, entry]) => ({ poolId, scope, ...entry })) : [];
}

function updateCachedFitness(poolId, scope, until, reason = "") {
  const byScope = fitness.get(poolId) || new Map();
  byScope.set(scope, { until, reason });
  fitness.set(poolId, byScope);
}

// Nothing to hydrate from disk in the in-memory adaptation. Kept on the API so
// callers (e.g. a pool-load path) can invoke it harmlessly.
export async function loadPoolFitness(_poolId) {
  return;
}

export async function markPoolUnfit(poolId, scope, until = Date.now() + POOL_UNFIT_MS, reason = "") {
  if (!poolId || !scope || !Number.isFinite(until)) return false;
  updateCachedFitness(poolId, scope, until, reason);
  return true;
}

export async function clearPoolUnfit(poolId, scope) {
  if (!poolId || !scope) return false;
  const byScope = fitness.get(poolId);
  if (byScope) {
    byScope.delete(scope);
    if (byScope.size === 0) fitness.delete(poolId);
  }
  return true;
}

function providerWildcardScope(scope) {
  const sep = String(scope || "").indexOf("::");
  if (sep < 0) return null;
  return `${scope.slice(0, sep)}::*`;
}

export function isPoolFit(poolId, scope, now = Date.now()) {
  if (!poolId) return true;
  const byScope = fitness.get(poolId);
  if (!byScope) return true;
  for (const key of [scope, providerWildcardScope(scope)]) {
    if (!key) continue;
    const entry = byScope.get(key);
    if (!entry) continue;
    if (entry.until <= now) {
      byScope.delete(key);
      if (byScope.size === 0) fitness.delete(poolId);
      continue;
    }
    return false;
  }
  return true;
}

export function fitPoolIds(poolIds, scope, now = Date.now()) {
  return (poolIds || []).filter((id) => isPoolFit(id, scope, now));
}

export async function clearAllPoolUnfit(provider = null) {
  if (!provider) {
    fitness.clear();
  } else {
    const prefix = `${provider}::`;
    for (const [poolId, byScope] of fitness) {
      for (const scope of [...byScope.keys()]) {
        if (scope.startsWith(prefix)) byScope.delete(scope);
      }
      if (byScope.size === 0) fitness.delete(poolId);
    }
  }
  return true;
}

export async function resetPoolFitness() {
  fitness.clear();
  return true;
}

export async function pruneExpired(now = Date.now()) {
  let removed = 0;
  for (const [poolId, byScope] of fitness) {
    for (const [scope, entry] of byScope) {
      if (entry.until <= now) {
        byScope.delete(scope);
        removed += 1;
      }
    }
    if (byScope.size === 0) fitness.delete(poolId);
  }
  return removed;
}

export async function poolFitnessSnapshot(now = Date.now()) {
  const out = {};
  for (const [poolId, byScope] of fitness) {
    for (const [scope, entry] of byScope) {
      if (entry.until <= now) {
        byScope.delete(scope);
        continue;
      }
      const scopeMap = out[poolId] || (out[poolId] = {});
      scopeMap[scope] = { until: entry.until, reason: entry.reason || "" };
    }
    if (byScope.size === 0) fitness.delete(poolId);
  }
  return out;
}
