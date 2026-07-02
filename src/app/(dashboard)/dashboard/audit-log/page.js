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
import { Card, Pagination, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/components";

const fmtTime = (ts) => new Date(ts).toLocaleString([], {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// Color + icon per action category.
const ACTION_META = {
  "user.login": { icon: "login", tone: "text-green-600 dark:text-green-400" },
  "user.login_failed": { icon: "lock", tone: "text-red-500" },
  "user.logout": { icon: "logout", tone: "text-text-muted" },
  "user.create": { icon: "person_add", tone: "text-blue-500" },
  "user.update": { icon: "edit", tone: "text-text-main" },
  "user.delete": { icon: "person_remove", tone: "text-red-500" },
  "user.change_password": { icon: "key", tone: "text-text-main" },
  "key.create": { icon: "add_circle", tone: "text-blue-500" },
  "key.delete": { icon: "remove_circle", tone: "text-red-500" },
  "role.create": { icon: "shield", tone: "text-blue-500" },
  "role.update": { icon: "shield", tone: "text-text-main" },
  "role.delete": { icon: "shield", tone: "text-red-500" },
  "backup.export": { icon: "download", tone: "text-text-main" },
  "backup.import": { icon: "upload", tone: "text-amber-600 dark:text-amber-400" },
};

export default function AuditLogPage() {
  const [data, setData] = useState({ entries: [], total: 0, actions: [] });
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (actionFilter) params.set("action", actionFilter);
      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  const columns = useMemo(() => [
    {
      accessorKey: "timestamp",
      header: "When",
      cell: ({ row }) => <span className="text-xs text-text-muted whitespace-nowrap tabular-nums">{fmtTime(row.original.timestamp)}</span>,
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => {
        const a = row.original.action;
        const meta = ACTION_META[a] || { icon: "circle", tone: "text-text-muted" };
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.tone}`}>
            <span className="material-symbols-outlined text-[15px]">{meta.icon}</span>
            {a}
          </span>
        );
      },
    },
    {
      accessorKey: "actorUsername",
      header: "Actor",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.actorUsername || <span className="text-text-muted">—</span>}</span>
      ),
    },
    {
      id: "target",
      header: "Target",
      cell: ({ row }) => {
        const r = row.original;
        const label = r.targetType ? `${r.targetType}${r.meta?.name ? ` · ${r.meta.name}` : ""}` : "—";
        return <span className="text-xs text-text-muted">{label}</span>;
      },
    },
    {
      accessorKey: "ip",
      header: "IP",
      cell: ({ row }) => <span className="text-xs font-mono text-text-muted">{row.original.ip || "—"}</span>,
    },
  ], []);

  const table = useReactTable({
    data: data.entries,
    columns,
    state: { pagination: { pageIndex: 0, pageSize } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="flex flex-col gap-4 px-1 sm:px-0">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-[28px] text-primary">history_edu</span>
            Audit Log
          </h1>
          <p className="text-sm text-text-muted mt-1">Who did what, when. {data.total} event(s).</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-border bg-bg-input text-sm focus:outline-none focus:border-primary"
          >
            <option value="">All actions</option>
            {(data.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={fetchData} className="p-2 rounded-lg border border-border text-text-muted hover:text-primary transition-colors" title="Refresh">
            <span className="material-symbols-outlined text-[20px]">refresh</span>
          </button>
        </div>
      </div>

      <Card padding="none" className="overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-text-muted">Loading…</div>
        ) : data.entries.length === 0 ? (
          <div className="p-12 text-center text-text-muted">
            <span className="material-symbols-outlined text-[40px] text-text-muted/50">inbox</span>
            <p className="mt-2">No audit events yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
