"use client";

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Card, Button, Input, Modal, Pagination,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/shared/components";
import { PERMISSION_CATALOG, PERMISSION_META, ALL_PERMISSIONS } from "@/shared/constants/permissions";

const permLabel = (k) => PERMISSION_META[k]?.label || k;

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [userCounts, setUserCounts] = useState({}); // roleId -> count
  const [loading, setLoading] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [editing, setEditing] = useState(null); // role | "new" | null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");

  const fetchData = async () => {
    try {
      const [r, u] = await Promise.all([fetch("/api/roles"), fetch("/api/users")]);
      const rd = await r.json();
      const ud = await u.json();
      setRoles(rd.roles || []);
      const counts = {};
      for (const user of (ud.users || [])) counts[user.roleId] = (counts[user.roleId] || 0) + 1;
      setUserCounts(counts);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const columns = useMemo(() => [
    {
      id: "expand",
      header: () => null,
      cell: ({ row }) =>
        row.getCanExpand() ? (
          <button
            onClick={row.getToggleExpandedHandler()}
            className="p-1 rounded hover:bg-surface-2 text-text-muted transition-transform"
            style={{ transform: row.getIsExpanded() ? "rotate(90deg)" : "none" }}
            title={row.getIsExpanded() ? "Collapse" : "Show permissions"}
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        ) : null,
      enableSorting: false,
      size: 36,
    },
    {
      accessorKey: "name",
      header: "Role",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-text-main flex items-center gap-2">
              {r.name}
              {r.isSystem && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[10px]">verified</span> SYSTEM
                </span>
              )}
            </span>
            {r.description && <span className="text-xs text-text-muted">{r.description}</span>}
          </div>
        );
      },
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: ({ row }) => {
        const r = row.original;
        const isFull = r.permissions.length >= ALL_PERMISSIONS.length;
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isFull ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-black/5 dark:bg-white/5 text-text-main"}`}>
            <span className="material-symbols-outlined text-[13px]">{isFull ? "check_circle" : "key"}</span>
            {isFull ? "Full access" : `${r.permissions.length} / ${ALL_PERMISSIONS.length}`}
          </span>
        );
      },
    },
    {
      id: "users",
      header: "Assigned",
      cell: ({ row }) => {
        const c = userCounts[row.original.id] || 0;
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <span className="material-symbols-outlined text-[14px]">group</span>
            {c} user{c !== 1 ? "s" : ""}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => setEditing(r)} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-colors" title={r.isSystem ? "View" : "Edit"}>
              <span className="material-symbols-outlined text-[18px]">{r.isSystem ? "visibility" : "edit"}</span>
            </button>
            {!r.isSystem && (
              <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors" title="Delete">
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            )}
          </div>
        );
      },
    },
  ], [userCounts]);

  const table = useReactTable({
    data: roles,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  if (loading) return <Card className="p-8 text-center text-text-muted">Loading…</Card>;

  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Roles & Permissions</h1>
          <p className="text-sm text-text-muted mt-1">
            Create custom roles and choose exactly what each one can do. Assign roles to users on the Users page.
          </p>
        </div>
        <Button icon="add" onClick={() => setEditing("new")}>New Role</Button>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

      <Card className="p-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 p-3 border-b border-border-subtle">
          <div className="relative w-full max-w-xs">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
            <input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search roles…"
              className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <span className="text-xs text-text-muted shrink-0">{roles.length} role{roles.length !== 1 ? "s" : ""}</span>
        </div>

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: header.column.columnDef.size ? `${header.column.columnDef.size}px` : undefined }}
                      onClick={header.column.getToggleSortingHandler()}
                      className={header.column.getCanSort() ? "cursor-pointer select-none hover:text-text-main" : ""}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" && <span className="material-symbols-outlined text-[13px]">arrow_upward</span>}
                        {sorted === "desc" && <span className="material-symbols-outlined text-[13px]">arrow_downward</span>}
                        {header.column.getCanSort() && !sorted && <span className="material-symbols-outlined text-[13px] opacity-20">unfold_more</span>}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-text-muted py-12">
                  {globalFilter ? "No roles match your search." : "No roles yet. Create one to get started."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && (
                    <TableRow className="hover:bg-transparent bg-surface-2/30">
                      <TableCell colSpan={row.getVisibleCells().length} className="py-4">
                        <PermissionDetail role={row.original} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Pagination
        currentPage={table.getState().pagination.pageIndex + 1}
        pageSize={table.getState().pagination.pageSize}
        totalItems={table.getFilteredRowModel().rows.length}
        onPageChange={(page) => table.setPageIndex(page - 1)}
        onPageSizeChange={(size) => table.setPageSize(size)}
      />

      {editing && (
        <RoleEditor
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchData(); }}
        />
      )}

      {confirmDelete && (
        <Modal
          isOpen title="Delete role" size="sm"
          onClose={() => setConfirmDelete(null)}
          footer={<><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={async () => {
            const res = await fetch(`/api/roles/${confirmDelete.id}`, { method: "DELETE" });
            if (!res.ok) { const d = await res.json(); setError(d.error || "Failed"); }
            setConfirmDelete(null); fetchData();
          }}>Delete</Button></>}
        >
          <p className="text-sm text-text-muted">Delete <b>{confirmDelete.name}</b>? {(userCounts[confirmDelete.id] || 0) > 0 ? `${userCounts[confirmDelete.id]} user(s) are assigned — reassign them first.` : "This action cannot be undone."}</p>
        </Modal>
      )}
    </div>
  );
}

// Expanded row: show the role's permissions grouped by category, as chips.
function PermissionDetail({ role }) {
  const byGroup = useMemo(() => {
    const map = {};
    for (const g of PERMISSION_CATALOG) {
      const held = g.permissions.filter((p) => role.permissions.includes(p.key)).map((p) => p.key);
      if (held.length) map[g.group] = { label: g.label, keys: held, total: g.permissions.length };
    }
    return map;
  }, [role]);

  const isFull = role.permissions.length >= ALL_PERMISSIONS.length;

  if (isFull) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 pl-9">
        <span className="material-symbols-outlined text-[18px]">check_circle</span>
        This role has every permission.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pl-9">
      {Object.entries(byGroup).map(([group, info]) => (
        <div key={group} className="flex items-start gap-3">
          <span className="text-[11px] font-medium text-text-muted w-28 shrink-0 pt-1">{info.label}</span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {info.keys.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-text-main">
                <span className="material-symbols-outlined text-[11px] text-green-500">check</span>
                {permLabel(k)}
              </span>
            ))}
            {info.keys.length < info.total && (
              <span className="text-[11px] px-2 py-0.5 rounded-md text-text-muted/50">+{info.total - info.keys.length} off</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Role editor modal (unchanged: grouped permission toggles with search) ──
function RoleEditor({ role, onClose, onSaved }) {
  const isNew = !role;
  const readOnly = role?.isSystem === true;
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [perms, setPerms] = useState(() => new Set(role?.permissions || (readOnly ? ALL_PERMISSIONS : [])));
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const togglePerm = (key) => {
    if (readOnly) return;
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleGroup = (groupKeys) => {
    if (readOnly) return;
    const allOn = groupKeys.every((k) => perms.has(k));
    setPerms((prev) => {
      const next = new Set(prev);
      groupKeys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const selectAll = () => !readOnly && setPerms(new Set(ALL_PERMISSIONS));
  const clearAll = () => !readOnly && setPerms(new Set());

  const save = async () => {
    setError("");
    if (!name.trim()) { setError("Role name is required"); return; }
    const body = { name: name.trim(), description: description.trim(), permissions: [...perms] };
    const res = await fetch(isNew ? "/api/roles" : `/api/roles/${role.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) onSaved();
    else setError(data.error || "Failed to save");
  };

  const q = search.trim().toLowerCase();
  const filteredGroups = PERMISSION_CATALOG
    .map((g) => ({
      ...g,
      permissions: q
        ? g.permissions.filter((p) => p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.key.includes(q))
        : g.permissions,
    }))
    .filter((g) => !q || g.permissions.length > 0 || g.label.toLowerCase().includes(q));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isNew ? "Create role" : (readOnly ? `View: ${role.name}` : `Edit: ${role.name}`)}
      size="full"
      footer={
        <>
          {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          {!readOnly && <Button onClick={save} icon="save">{isNew ? "Create role" : "Save changes"}</Button>}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {readOnly && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2">
            <span className="material-symbols-outlined text-[16px] mt-px">info</span>
            <span>This is the system admin role — it always has every permission and cannot be reduced. You may rename it.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Role name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly && !isNew} placeholder="e.g. Developer" />
          <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this role for?" />
        </div>

        <div className="sticky top-0 -mt-1 pt-1 bg-surface z-10 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-text-muted text-[18px]">key</span>
              <span className="text-sm font-medium">Permissions</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {perms.size} / {ALL_PERMISSIONS.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!readOnly && <Button variant="ghost" size="sm" onClick={selectAll}>Select all</Button>}
              {!readOnly && <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>}
            </div>
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search permissions…"
              className="w-full pl-8 pr-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {filteredGroups.map((group) => {
            const groupKeys = group.permissions.map((p) => p.key);
            const held = groupKeys.filter((k) => perms.has(k)).length;
            const allOn = groupKeys.length > 0 && held === groupKeys.length;
            const someOn = held > 0 && !allOn;
            return (
              <div key={group.group} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
                <GroupHeader
                  label={group.label}
                  count={held}
                  total={groupKeys.length}
                  checked={allOn}
                  indeterminate={someOn}
                  disabled={readOnly || groupKeys.length === 0}
                  onToggle={() => toggleGroup(groupKeys)}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
                  {group.permissions.map((p) => {
                    const on = perms.has(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => togglePerm(p.key)}
                        disabled={readOnly}
                        title={p.key}
                        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${readOnly ? "cursor-default" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"} ${on ? "bg-primary/[0.06] ring-1 ring-primary/20" : ""}`}
                      >
                        <span className={`mt-px shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${on ? "bg-primary border-primary" : "border-black/20 dark:border-white/25 bg-surface"} ${readOnly ? "opacity-60" : ""}`}>
                          {on && <span className="material-symbols-outlined text-white text-[15px] leading-none font-bold">check</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-text-main leading-tight">{p.label}</span>
                          <span className="block text-[11px] text-text-muted leading-snug mt-0.5">{p.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                  {group.permissions.length === 0 && (
                    <p className="text-[11px] text-text-muted/50 px-3 py-2">No matches.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function GroupHeader({ label, count, total, checked, indeterminate, disabled, onToggle }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 bg-black/[0.02] dark:bg-white/[0.02]">
      <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="accent-primary w-4 h-4" />
      <span className="text-xs font-semibold text-text-main">{label}</span>
      <span className="text-[10px] text-text-muted ml-auto">{count}/{total}</span>
    </div>
  );
}
