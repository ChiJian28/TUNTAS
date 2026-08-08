"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ScheduleAssignmentView } from "@/lib/api/generated/openapi.types";
import { formatMyr } from "@/lib/format/money";
import { formatKl } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { openEmployeeInUrl } from "@/features/runs/employee-drawer";

type AssignmentsTableProps = {
  runId: string;
  assignments: ScheduleAssignmentView[];
  selectedSessionId: string | null;
};

export function AssignmentsTable({
  runId,
  assignments,
  selectedSessionId,
}: AssignmentsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setEmployeeDrawerRef = useUiStore((s) => s.setEmployeeDrawerRef);

  const rows = useMemo(() => {
    if (!selectedSessionId) return assignments;
    return assignments.filter((a) => a.session_id === selectedSessionId);
  }, [assignments, selectedSessionId]);

  const columns = useMemo<ColumnDef<ScheduleAssignmentView>[]>(
    () => [
      {
        accessorKey: "employee_ref",
        header: "Employee",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.employee_ref}</span>
        ),
      },
      {
        accessorKey: "course_code",
        header: "Course",
      },
      {
        accessorKey: "session_title",
        header: "Session",
        cell: ({ row }) => row.original.session_title ?? "Unknown",
      },
      {
        id: "window",
        header: "Window (KL)",
        cell: ({ row }) =>
          row.original.starts_at
            ? `${formatKl(row.original.starts_at)} – ${formatKl(row.original.ends_at)}`
            : "Unknown",
      },
      {
        accessorKey: "cost_myr",
        header: "Cost",
        cell: ({ row }) => formatMyr(row.original.cost_myr),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignments</CardTitle>
        <CardDescription>
          {rows.length} row{rows.length === 1 ? "" : "s"}
          {selectedSessionId
            ? " · filtered by calendar selection"
            : " · linked to calendar selection when a session is chosen"}
          . Click a row to open employee drawer (?employee=).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <EmptyState
            title="No assignments"
            description="API returned an empty assignments list."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted-foreground)]">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className="px-3 py-2 font-medium">
                        {h.isPlaceholder
                          ? null
                          : flexRender(
                              h.column.columnDef.header,
                              h.getContext(),
                            )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface)]",
                      selectedSessionId &&
                        row.original.session_id === selectedSessionId &&
                        "bg-[var(--primary-soft)]/40",
                    )}
                    onClick={() =>
                      openEmployeeInUrl(
                        router,
                        pathname,
                        searchParams,
                        row.original.employee_ref,
                        setEmployeeDrawerRef,
                      )
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2.5">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* runId kept for future deep-links / proof lens */}
        <span className="sr-only">{runId}</span>
      </CardContent>
    </Card>
  );
}
