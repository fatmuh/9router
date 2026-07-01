// shadcn-style table primitives (Table, Header, Body, Row, Head, Cell).
// Visual replica of shadcn/ui table, built with Tailwind to avoid pulling the
// full shadcn/radix CLI. Used together with @tanstack/react-table.

import { cn } from "@/shared/utils/cn";

export function Table({ className, ...props }) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }) {
  return (
    <tr
      className={cn(
        "border-b border-border-subtle transition-colors hover:bg-surface-2/60 data-[state=selected]:bg-primary/5",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-semibold text-text-muted uppercase tracking-wide whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }) {
  return (
    <td className={cn("px-3 py-2.5 align-middle text-sm text-text-main", className)} {...props} />
  );
}
