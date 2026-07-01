"use client";

import { useState, useEffect, useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Card, Button, Input, Modal, Pagination, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/components";
import ModelMultiSelectModal from "@/shared/components/ModelMultiSelectModal";

function fmtLogin(iso) {
  if (!iso) return "—";
  const diffMins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [quotaMap, setQuotaMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");

  const fetchData = async () => {
    try {
      const [u, r, q] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/roles"),
        fetch("/api/usage/quota/all").then((x) => x.ok ? x.json() : null).catch(() => null),
      ]);
      const ud = await u.json();
      const rd = await r.json();
      setUsers(ud.users || []);
      setRoles(rd.roles || []);
      if (q?.statuses) {
        const m = {};
        for (const s of q.statuses) m[s.userId] = s;
        setQuotaMap(m);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const roleName = (id) => roles.find((r) => r.id === id)?.name || id;

  const columns = useMemo(() => [
    {
      accessorKey: "username",
      header: "User",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold uppercase shrink-0">
              {u.username.slice(0, 2)}
            </div>
            <div>
              <div className="font-medium text-text-main flex items-center gap-1.5">
                {u.username}
                {u.roleId === "role-admin" && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-[10px]">verified</span> ADMIN
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "roleId",
      header: "Role",
      cell: ({ row }) => {
        const r = roles.find((x) => x.id === row.original.roleId);
        return (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="material-symbols-outlined text-[14px] text-text-muted">shield</span>
            {r?.name || row.original.roleId}
            {r?.description && <span className="text-text-muted/60 hidden md:inline">· {r.description}</span>}
          </span>
        );
      },
    },
    {
      id: "tokenUsage",
      header: "Token Usage",
      cell: ({ row }) => {
        const q = quotaMap[row.original.id];
        if (!q || q.isUnlimited) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <span className="material-symbols-outlined text-[13px]">all_inclusive</span> Unlimited
            </span>
          );
        }
        const fmtT = (n) => new Intl.NumberFormat().format(n || 0);
        const color = q.isFull ? "bg-red-500" : q.isNearFull ? "bg-amber-500" : "bg-green-500";
        return (
          <div className="flex flex-col gap-1 min-w-[140px]">
            <div className="flex items-center justify-between text-[11px] tabular-nums">
              <span className={q.isFull ? "text-red-500 font-semibold" : "text-text-main font-medium"}>
                {fmtT(q.usedTokens)}
              </span>
              <span className="text-text-muted">/ {fmtT(q.limitTokens)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
              <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${q.percentFull}%` }} />
            </div>
            <span className="text-[10px] text-text-muted">
              {q.notStarted ? `${q.windowLabel} · not started` : `${q.windowLabel} · ${q.percentFull}%`}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "isActive",
      header: "Status",
      cell: ({ row }) => (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${row.original.isActive ? "text-green-600 dark:text-green-400" : "text-orange-500"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${row.original.isActive ? "bg-green-500" : "bg-orange-400"}`} />
          {row.original.isActive ? "Active" : "Paused"}
        </span>
      ),
    },
    {
      accessorKey: "lastLoginAt",
      header: "Last login",
      cell: ({ row }) => <span className="text-xs text-text-muted">{fmtLogin(row.original.lastLoginAt)}</span>,
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const u = row.original;
        const isAdmin = u.roleId === "role-admin";
        return (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => setEditing(u)} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-colors" title="Edit user">
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
            <button onClick={() => setConfirm({ type: "reset", user: u })} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-primary transition-colors" title="Reset password">
              <span className="material-symbols-outlined text-[18px]">key</span>
            </button>
            {!isAdmin && (
              <button onClick={() => setConfirm({ type: "delete", user: u })} className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors" title="Delete user">
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            )}
          </div>
        );
      },
    },
  ], [roles, quotaMap]);

  const table = useReactTable({
    data: users,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (loading) return <Card className="p-8 text-center text-text-muted">Loading…</Card>;

  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-text-muted mt-1">Manage who can access 9Router and what they can do.</p>
        </div>
        <Button icon="person_add" onClick={() => setShowAdd(true)}>Add User</Button>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}

      <Card className="p-0 overflow-hidden">
        {/* Toolbar: search + count */}
        <div className="flex items-center justify-between gap-3 p-3 border-b border-border-subtle">
          <div className="relative w-full max-w-xs">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
            <input
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search users…"
              className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <span className="text-xs text-text-muted shrink-0">{users.length} user{users.length !== 1 ? "s" : ""}</span>
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
                  {globalFilter ? "No users match your search." : "No users yet."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <Pagination
        currentPage={table.getState().pagination.pageIndex + 1}
        pageSize={table.getState().pagination.pageSize}
        totalItems={table.getFilteredRowModel().rows.length}
        onPageChange={(page) => table.setPageIndex(page - 1)}
        onPageSizeChange={(size) => table.setPageSize(size)}
      />

      {/* Add User Modal */}
      <Modal isOpen={showAdd} title="Add User" onClose={() => setShowAdd(false)} size="sm">
        <AddUserForm roles={roles} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchData(); }} />
      </Modal>

      {/* Edit User Modal */}
      {editing && (
        <Modal isOpen title={`Edit ${editing.username}`} onClose={() => setEditing(null)} size="sm">
          <EditUserForm user={editing} roles={roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); fetchData(); }} />
        </Modal>
      )}

      {/* Confirm: delete */}
      {confirm?.type === "delete" && (
        <Modal
          isOpen title="Delete user" size="sm" onClose={() => setConfirm(null)}
          footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={async () => {
            const res = await fetch(`/api/users/${confirm.user.id}`, { method: "DELETE" });
            if (!res.ok) { const d = await res.json(); setError(d.error); }
            setConfirm(null); fetchData();
          }}>Delete</Button></>}
        >
          <p className="text-sm text-text-muted">Delete <b>{confirm.user.username}</b>? Their API keys remain (reassign or delete separately).</p>
        </Modal>
      )}

      {/* Confirm: reset password */}
      {confirm?.type === "reset" && (
        <ResetPasswordModal user={confirm.user} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

function AddUserForm({ roles, onClose, onSaved }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id || "");
  const [limitTokens, setLimitTokens] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [limitUnit, setLimitUnit] = useState("hours");
  const [oidcSubject, setOidcSubject] = useState("");
  const [allowedModels, setAllowedModels] = useState([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [error, setError] = useState("");

  const windowToMs = (value, unit) => {
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0) return null;
    const mult = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : unit === "days" ? 86_400_000 : 3_600_000;
    return Math.floor(n * mult);
  };

  const submit = async () => {
    setError("");
    if (!username || !password || !roleId) { setError("Username, password, and role are required"); return; }
    const res = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, roleId, oidcSubject: oidcSubject.trim() || null, allowedModels: allowedModels.length ? allowedModels : null, limitTokens: limitTokens ? Number(limitTokens) : null, limitWindowMs: windowToMs(limitValue, limitUnit) }),
    });
    const data = await res.json();
    if (res.ok) onSaved(); else setError(data.error || "Failed");
  };

  return (
    <div className="flex flex-col gap-4">
      <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. john" autoFocus />
      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
      <div>
        <label className="block text-sm font-medium mb-1.5">Role</label>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-bg-input text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isSystem ? " (system)" : ""}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">Token Quota <span className="text-text-muted font-normal">(optional, account-wide)</span></label>
        <div className="grid grid-cols-3 gap-2">
          <Input type="number" min="1" placeholder="Tokens" value={limitTokens} onChange={(e) => setLimitTokens(e.target.value)} />
          <Input type="number" min="1" placeholder="Every" value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />
          <select value={limitUnit} onChange={(e) => setLimitUnit(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-bg-input text-sm">
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
        <p className="text-xs text-text-muted mt-1">Limits ALL of this user&lsquo;s API keys combined. Leave empty = unlimited.</p>
      </div>
      <Input label="OIDC Subject (optional)" value={oidcSubject} onChange={(e) => setOidcSubject(e.target.value)} placeholder="e.g. user@example.com or OIDC sub" />
      <p className="text-xs text-text-muted -mt-2">Link this account to an OIDC identity (Authentik/Google). Only registered subjects may log in via OIDC.</p>
      <div>
        <label className="block text-sm font-medium mb-1.5">Allowed Models <span className="text-text-muted font-normal">(account-wide, optional)</span></label>
        <button type="button" onClick={() => setShowModelPicker(true)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-bg-input text-sm hover:border-primary/40 transition-colors">
          <span className={allowedModels.length ? "text-text-main" : "text-text-muted"}>{allowedModels.length ? `${allowedModels.length} model(s) selected` : "All models (click to restrict)"}</span>
          <span className="material-symbols-outlined text-[18px] text-text-muted">tune</span>
        </button>
        {allowedModels.length > 0 && (
          <button type="button" onClick={() => setAllowedModels([])} className="text-xs text-text-muted hover:text-red-500 mt-1">Clear (allow all)</button>
        )}
      </div>
      <ModelMultiSelectModal isOpen={showModelPicker} onClose={() => setShowModelPicker(false)} selected={allowedModels} onChange={setAllowedModels} />
      {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} fullWidth>Create</Button>
        <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
      </div>
    </div>
  );
}

function EditUserForm({ user, roles, onClose, onSaved }) {
  const [username, setUsername] = useState(user.username);
  const [roleId, setRoleId] = useState(user.roleId);
  const [isActive, setIsActive] = useState(user.isActive);
  const [oidcSubject, setOidcSubject] = useState(user.oidcSubject || "");
  const [allowedModels, setAllowedModels] = useState(user.allowedModels || []);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [limitTokens, setLimitTokens] = useState(user.limitTokens != null ? String(user.limitTokens) : "");
  const [error, setError] = useState("");
  const msToWindow = (ms) => {
    if (!ms || ms <= 0) return { value: "", unit: "hours" };
    if (ms % 86_400_000 === 0) return { value: String(ms / 86_400_000), unit: "days" };
    if (ms % 3_600_000 === 0) return { value: String(ms / 3_600_000), unit: "hours" };
    if (ms % 60_000 === 0) return { value: String(ms / 60_000), unit: "minutes" };
    return { value: String(Math.round(ms / 3_600_000)), unit: "hours" };
  };
  const [w, setW] = useState(() => msToWindow(user.limitWindowMs));
  const windowToMs = (value, unit) => {
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0) return null;
    const mult = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : unit === "days" ? 86_400_000 : 3_600_000;
    return Math.floor(n * mult);
  };

  const save = async () => {
    setError("");
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, roleId, isActive, oidcSubject: oidcSubject.trim() || null, allowedModels: allowedModels.length ? allowedModels : null, limitTokens: limitTokens ? Number(limitTokens) : null, limitWindowMs: windowToMs(w.value, w.unit) }),
    });
    const data = await res.json();
    if (res.ok) onSaved(); else setError(data.error || "Failed");
  };

  return (
    <div className="flex flex-col gap-4">
      <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <div>
        <label className="block text-sm font-medium mb-1.5">Role</label>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-bg-input text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isSystem ? " (system)" : ""}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">Token Quota <span className="text-text-muted font-normal">(account-wide)</span></label>
        <div className="grid grid-cols-3 gap-2">
          <Input type="number" min="1" placeholder="Tokens" value={limitTokens} onChange={(e) => setLimitTokens(e.target.value)} />
          <Input type="number" min="1" placeholder="Every" value={w.value} onChange={(e) => setW({ ...w, value: e.target.value })} />
          <select value={w.unit} onChange={(e) => setW({ ...w, unit: e.target.value })} className="px-3 py-2 rounded-lg border border-border bg-bg-input text-sm">
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      </div>
      <Input label="OIDC Subject" value={oidcSubject} onChange={(e) => setOidcSubject(e.target.value)} placeholder="e.g. user@example.com or OIDC sub" />
      <p className="text-xs text-text-muted -mt-2">Link to an OIDC identity so this user can log in via Authentik/Google SSO.</p>
      <div>
        <label className="block text-sm font-medium mb-1.5">Allowed Models <span className="text-text-muted font-normal">(account-wide)</span></label>
        <button type="button" onClick={() => setShowModelPicker(true)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-bg-input text-sm hover:border-primary/40 transition-colors">
          <span className={allowedModels.length ? "text-text-main" : "text-text-muted"}>{allowedModels.length ? `${allowedModels.length} model(s) selected` : "All models (click to restrict)"}</span>
          <span className="material-symbols-outlined text-[18px] text-text-muted">tune</span>
        </button>
        {allowedModels.length > 0 && (
          <button type="button" onClick={() => setAllowedModels([])} className="text-xs text-text-muted hover:text-red-500 mt-1">Clear (allow all)</button>
        )}
      </div>
      <ModelMultiSelectModal isOpen={showModelPicker} onClose={() => setShowModelPicker(false)} selected={allowedModels} onChange={setAllowedModels} />
      <label className="flex items-center gap-2.5 text-sm cursor-pointer">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-primary w-4 h-4" />
        <span className="font-medium">Active</span>
      </label>
      {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={save} fullWidth>Save</Button>
        <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const [pwd, setPwd] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (pwd.length < 6) { setError("At least 6 characters"); return; }
    const res = await fetch(`/api/users/${user.id}/reset-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    if (res.ok) setDone(true); else { const d = await res.json(); setError(d.error || "Failed"); }
  };

  return (
    <Modal isOpen title={`Reset password: ${user.username}`} onClose={onClose} size="sm">
      {done ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-green-600 flex items-center gap-2"><span className="material-symbols-outlined text-[18px]">check_circle</span>Password updated.</p>
          <Button onClick={onClose} fullWidth>Close</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Input label="New Password" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="At least 6 characters" autoFocus />
          {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={submit} fullWidth>Reset</Button>
            <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
