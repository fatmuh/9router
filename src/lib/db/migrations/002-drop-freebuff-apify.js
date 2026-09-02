// Remove all freebuff + apify data: drop apify keys, purge freebuff connections,
// usage rows, request details, proxy-pool fitness scopes, and combos that
// reference fb/* models (provider removed from the registry).
export default {
  version: 2,
  name: "drop-freebuff-apify",
  up(db) {
    db.exec("DROP TABLE IF EXISTS apifyKeys");

    db.exec("DELETE FROM providerConnections WHERE provider = 'freebuff'");
    db.exec("DELETE FROM usageHistory WHERE provider = 'freebuff'");
    db.exec("DELETE FROM requestDetails WHERE provider = 'freebuff'");
    db.exec("DELETE FROM proxyPoolFitness WHERE scope LIKE 'freebuff::%'");

    // Combos store models as a JSON array — remove any combo referencing fb/*
    let droppedCombos = 0;
    try {
      const rows = db.all("SELECT id, models FROM combos");
      for (const row of rows) {
        let models = null;
        try { models = JSON.parse(row.models); } catch { models = null; }
        const refs = Array.isArray(models) && models.some(
          (m) => typeof m === "string" && m.startsWith("fb/")
        );
        if (refs) {
          db.run("DELETE FROM combos WHERE id = ?", [row.id]);
          droppedCombos++;
        }
      }
    } catch (e) {
      console.warn("[DB][migrate][002] combo sweep skipped:", e.message);
    }

    console.log(
      `[DB][migrate][002] freebuff/apify purge done (droppedCombos=${droppedCombos})`
    );
  },
};
