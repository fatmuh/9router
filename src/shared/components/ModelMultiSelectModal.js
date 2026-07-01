"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";

/**
 * Multi-select model picker for API-key "Allowed Models" scoping.
 * Fetches all selectable models (built-in + custom + connection) + combos from
 * /api/keys/models, grouped by provider. Supports search + "select all" per group.
 *
 * @param {boolean} isOpen
 * @param {function} onClose
 * @param {string[]} selected - array of model value strings
 * @param {function} onChange - (string[]) => void
 */
export default function ModelMultiSelectModal({ isOpen, onClose, selected = [], onChange }) {
  const [data, setData] = useState({ groups: [], combos: [] });
  const [loading, setLoading] = useState(() => isOpen);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(() => new Set(selected));

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch("/api/keys/models")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (!cancelled) setData({ groups: d.groups || [], combos: d.combos || [] }); })
      .catch(() => { if (!cancelled) setData({ groups: [], combos: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const selectedSet = useMemo(() => draft, [draft]);

  const toggle = (value) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const toggleGroup = (group) => {
    setDraft((prev) => {
      const next = new Set(prev);
      const allSelected = group.models.every((m) => next.has(m.value));
      if (allSelected) group.models.forEach((m) => next.delete(m.value));
      else group.models.forEach((m) => next.add(m.value));
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.groups;
    return data.groups
      .map((g) => {
        const providerMatch = g.name.toLowerCase().includes(q);
        const models = g.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)
        );
        if (models.length === 0 && !providerMatch) return null;
        return { ...g, models: providerMatch && models.length === 0 ? g.models : models };
      })
      .filter(Boolean);
  }, [data.groups, search]);

  const filteredCombos = useMemo(() => {
    if (!search.trim()) return data.combos;
    const q = search.trim().toLowerCase();
    return data.combos.filter((c) => c.name.toLowerCase().includes(q));
  }, [data.combos, search]);

  const handleApply = () => {
    onChange([...draft]);
    onClose();
  };

  const handleClear = () => setDraft(new Set());

  const totalCount = useMemo(
    () => data.groups.reduce((s, g) => s + g.models.length, 0) + data.combos.length,
    [data.groups, data.combos]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Allowed Models" size="md" footer={null} className="p-4!">
      <div className="flex items-center justify-between mb-3 text-xs text-text-muted px-1">
        <span>
          <span className="font-medium text-primary">{selectedSet.size}</span> of {totalCount} selected
          {selectedSet.size > 0 && (
            <button onClick={handleClear} className="ml-2 text-red-500 hover:underline">
              Clear all
            </button>
          )}
        </span>
        <span className="italic">Empty = all models allowed</span>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
        <input
          type="text"
          placeholder="Search models or providers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        {loading && <p className="text-xs text-text-muted text-center py-6">Loading models…</p>}
        {!loading && totalCount === 0 && (
          <p className="text-xs text-text-muted text-center py-6">No models available. Connect a provider first.</p>
        )}

        {/* Combos */}
        {!loading && filteredCombos.length > 0 && (
          <div className="rounded-lg border border-black/5 dark:border-white/5 overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-primary/5 sticky top-0">
              <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="p-1.5 flex flex-col gap-0.5">
              {filteredCombos.map((c) => {
                const checked = selectedSet.has(c.value);
                return (
                  <label key={c.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs">
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.value)} className="accent-primary w-3.5 h-3.5" />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-[10px] text-text-muted">combo</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider groups */}
        {!loading &&
          filteredGroups.map((g) => {
            const selectedInGroup = g.models.filter((m) => selectedSet.has(m.value)).length;
            const allSelected = g.models.length > 0 && selectedInGroup === g.models.length;
            const someSelected = selectedInGroup > 0 && !allSelected;
            return (
              <div key={g.providerId} className="rounded-lg border border-black/5 dark:border-white/5 overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-black/[0.02] dark:bg-white/[0.02] sticky top-0">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={() => toggleGroup(g)}
                      className="accent-primary w-3.5 h-3.5"
                    />
                    <ProviderIcon src={`/providers/${g.providerId}.png`} alt={g.name} size={14} fallbackText={(g.name || "").slice(0, 2).toUpperCase()} fallbackColor={g.color} />
                    <span className="text-xs font-medium text-text-main truncate">{g.name}</span>
                    <span className="text-[10px] text-text-muted">({selectedInGroup}/{g.models.length})</span>
                  </label>
                </div>
                <div className="p-1.5 flex flex-col gap-0.5">
                  {g.models.map((m) => {
                    const checked = selectedSet.has(m.value);
                    return (
                      <label key={m.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs">
                        <input type="checkbox" checked={checked} onChange={() => toggle(m.value)} className="accent-primary w-3.5 h-3.5" />
                        <span className="truncate">{m.name}</span>
                        {m.isCustom && <span className="text-[9px] text-text-muted shrink-0">custom</span>}
                        <span className="text-[9px] text-text-muted/60 ml-auto shrink-0 font-mono">{m.value}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleApply}
          className="flex-1 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          Apply ({selectedSet.size})
        </button>
        <button
          onClick={onClose}
          className="flex-1 px-3 py-2 rounded-lg border border-border text-text-main text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

ModelMultiSelectModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  selected: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
};
