"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AICB_ATTRIBUTION } from "@/lib/constants/agents";
import { normalizeApiError } from "@/lib/api/errors";
import type { EmployeeListItem } from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import {
  competencyGapSchema,
  gapCode,
  gapLabel,
  safeParsePayload,
} from "@/lib/schemas/payloads";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { openEmployeeInUrl } from "@/features/runs/employee-drawer";

type HeatCell = {
  role: string;
  competency: string;
  count: number;
  avgGap: number | null;
  maxPriority: number | null;
};

type CellFilter = { role: string; competency: string } | null;

function riskLevel(count: number, maxCount: number): {
  label: string;
  tone: string;
} {
  if (maxCount <= 0 || count <= 0) {
    return {
      label: "None · 0",
      tone: "bg-[var(--surface)] text-[var(--muted-foreground)]",
    };
  }
  const ratio = count / maxCount;
  if (ratio >= 0.75) {
    return {
      label: `High · ${count}`,
      tone: "bg-[var(--destructive-soft)] text-[var(--destructive)]",
    };
  }
  if (ratio >= 0.4) {
    return {
      label: `Medium · ${count}`,
      tone: "bg-[var(--warning-soft)] text-[var(--warning)]",
    };
  }
  return {
    label: `Low · ${count}`,
    tone: "bg-[var(--success-soft)] text-[var(--success)]",
  };
}

function parseGaps(emp: EmployeeListItem) {
  return (emp.competency_gaps ?? []).flatMap((g) => {
    const parsed = safeParsePayload(competencyGapSchema, g);
    return parsed.ok ? [parsed.data] : [];
  });
}

type GapRisk = "high" | "medium" | "low" | "none";

/** Worst gap severity for narrative focus — not colour-only (tooltip/title carries label). */
function employeeGapRisk(emp: EmployeeListItem): GapRisk {
  const gaps = parseGaps(emp);
  if (gaps.length === 0) return "none";

  let maxLevelGap = 0;
  let minPriority = Number.POSITIVE_INFINITY;

  for (const g of gaps) {
    const levelGap =
      g.gap ??
      (g.target_level != null && g.current_level != null
        ? g.target_level - g.current_level
        : null);
    if (levelGap != null) maxLevelGap = Math.max(maxLevelGap, levelGap);
    const p = Number(g.gap_priority ?? g.priority);
    if (!Number.isNaN(p)) minPriority = Math.min(minPriority, p);
  }

  if (minPriority <= 1 || maxLevelGap >= 2) return "high";
  if (maxLevelGap >= 1 || minPriority <= 2) return "medium";
  return "low";
}

const GAP_RISK_DOT: Record<GapRisk, { className: string; label: string }> = {
  high: {
    className: "bg-[var(--destructive)]",
    label: "High risk gap",
  },
  medium: {
    className: "bg-[var(--warning)]",
    label: "Medium risk gap",
  },
  low: {
    className: "bg-[var(--success)]",
    label: "Low risk gap",
  },
  none: {
    className: "border border-[var(--border-strong)] bg-transparent",
    label: "No competency gaps",
  },
};

export function DiagnosticHeatmap({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setEmployeeDrawerRef = useUiStore((s) => s.setEmployeeDrawerRef);

  const employeesQuery = useQuery(apiQueries.employees(runId));
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [cellFilter, setCellFilter] = useState<CellFilter>(null);

  const employees = useMemo(
    () => employeesQuery.data ?? [],
    [employeesQuery.data],
  );

  const filterOptions = useMemo(() => {
    const roles = new Set<string>();
    const units = new Set<string>();
    const locations = new Set<string>();
    for (const e of employees) {
      if (e.role_code || e.role_title) {
        roles.add(e.role_code ?? e.role_title ?? "Unknown");
      }
      if (e.unit) units.add(e.unit);
      if (e.location) locations.add(e.location);
    }
    return {
      roles: [...roles].sort(),
      units: [...units].sort(),
      locations: [...locations].sort(),
    };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const role = e.role_code ?? e.role_title ?? "Unknown";
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (unitFilter !== "all" && (e.unit ?? "") !== unitFilter) return false;
      if (locationFilter !== "all" && (e.location ?? "") !== locationFilter) {
        return false;
      }
      return true;
    });
  }, [employees, roleFilter, unitFilter, locationFilter]);

  const { roles, competencies, cells, maxCount } = useMemo(() => {
    const roleSet = new Set<string>();
    const compSet = new Set<string>();
    const map = new Map<
      string,
      { count: number; gapSum: number; gapN: number; maxPriority: number | null }
    >();

    for (const emp of filteredEmployees) {
      const role = emp.role_code ?? emp.role_title ?? "Unknown";
      roleSet.add(role);
      const gaps = parseGaps(emp);
      for (const g of gaps) {
        const comp = gapCode(g);
        compSet.add(comp);
        const key = `${role}||${comp}`;
        const cur = map.get(key) ?? {
          count: 0,
          gapSum: 0,
          gapN: 0,
          maxPriority: null,
        };
        cur.count += 1;
        const levelGap =
          g.gap ??
          (g.target_level != null && g.current_level != null
            ? g.target_level - g.current_level
            : null);
        if (levelGap != null) {
          cur.gapSum += levelGap;
          cur.gapN += 1;
        }
        const p = Number(g.gap_priority ?? g.priority);
        if (!Number.isNaN(p)) {
          cur.maxPriority =
            cur.maxPriority == null ? p : Math.min(cur.maxPriority, p);
        }
        map.set(key, cur);
      }
    }

    const roleList = [...roleSet].sort();
    const compList = [...compSet].sort();
    const cellList: HeatCell[] = [];
    let max = 0;
    for (const role of roleList) {
      for (const competency of compList) {
        const cur = map.get(`${role}||${competency}`);
        const count = cur?.count ?? 0;
        max = Math.max(max, count);
        cellList.push({
          role,
          competency,
          count,
          avgGap: cur && cur.gapN > 0 ? cur.gapSum / cur.gapN : null,
          maxPriority: cur?.maxPriority ?? null,
        });
      }
    }
    return {
      roles: roleList,
      competencies: compList,
      cells: cellList,
      maxCount: max,
    };
  }, [filteredEmployees]);

  const cellLookup = useMemo(() => {
    const m = new Map<string, HeatCell>();
    for (const c of cells) m.set(`${c.role}||${c.competency}`, c);
    return m;
  }, [cells]);

  const tableEmployees = useMemo(() => {
    if (!cellFilter) return filteredEmployees;
    return filteredEmployees.filter((emp) => {
      const role = emp.role_code ?? emp.role_title ?? "Unknown";
      if (role !== cellFilter.role) return false;
      return parseGaps(emp).some((g) => gapCode(g) === cellFilter.competency);
    });
  }, [filteredEmployees, cellFilter]);

  const columns = useMemo<ColumnDef<EmployeeListItem>[]>(
    () => [
      {
        accessorKey: "pseudonym",
        header: "Employee",
        cell: ({ row }) => {
          const risk = employeeGapRisk(row.original);
          const dot = GAP_RISK_DOT[risk];
          return (
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  dot.className,
                )}
                title={dot.label}
                aria-label={dot.label}
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--foreground)]">
                  {row.original.pseudonym}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                  {row.original.employee_ref}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="line-clamp-2">
            {row.original.role_title ?? row.original.role_code ?? "Unknown"}
          </span>
        ),
      },
      {
        accessorKey: "unit",
        header: "Unit",
        cell: ({ row }) => {
          const unit = row.original.unit ?? "Unknown";
          return (
            <span className="block max-w-[9rem] break-words leading-snug">
              {unit}
            </span>
          );
        },
      },
      {
        accessorKey: "location",
        header: "Location",
        cell: ({ row }) => {
          const location = row.original.location ?? "Unknown";
          return (
            <span className="block max-w-[8.5rem] truncate" title={location}>
              {location}
            </span>
          );
        },
      },
      {
        id: "top_gap",
        header: "Top FSF gap",
        cell: ({ row }) => {
          const gaps = parseGaps(row.original);
          if (gaps.length === 0) {
            return (
              <span className="text-[var(--muted-foreground)]">—</span>
            );
          }
          const sorted = [...gaps].sort((a, b) => {
            const pa = Number(a.gap_priority ?? a.priority ?? 99);
            const pb = Number(b.gap_priority ?? b.priority ?? 99);
            return pa - pb;
          });
          const top = sorted[0];
          return (
            <div className="min-w-0 max-w-[220px] space-y-1">
              <span className="inline-flex max-w-full items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
                {gapCode(top)}
              </span>
              <p
                className="truncate text-xs text-[var(--muted-foreground)]"
                title={gapLabel(top)}
              >
                {gapLabel(top)}
              </p>
            </div>
          );
        },
      },
      {
        id: "levels",
        header: () => <span className="block text-right">Levels</span>,
        cell: ({ row }) => {
          const gaps = parseGaps(row.original);
          const top = [...gaps].sort((a, b) => {
            const pa = Number(a.gap_priority ?? a.priority ?? 99);
            const pb = Number(b.gap_priority ?? b.priority ?? 99);
            return pa - pb;
          })[0];
          const current =
            row.original.current_level ?? top?.current_level ?? "?";
          const target =
            row.original.target_level ?? top?.target_level ?? "?";
          return (
            <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
              {current} → {target}
            </span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: tableEmployees,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (employeesQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (employeesQuery.isError) {
    const err = normalizeApiError(employeesQuery.error);
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={`/v1/runs/${runId}/employees`}
        onRetry={() => void employeesQuery.refetch()}
      />
    );
  }

  if (employees.length === 0) {
    return (
      <EmptyState
        title="No employees in this run"
        description="GET /employees returned an empty array. Aggregation uses only API data — no synthetic expansion."
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="font-display">Diagnostic heatmap</CardTitle>
          <CardDescription>
            Role × competency gaps aggregated from the current employee list (
            {filteredEmployees.length} of {employees.length}).{" "}
            {AICB_ATTRIBUTION}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {filterOptions.roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All units</SelectItem>
                  {filterOptions.units.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {filterOptions.locations.map((loc) => (
                    <SelectItem key={loc} value={loc}>
                      {loc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--muted-foreground)]">
              Sequential risk scale (count / level — not colour-only):
            </span>
            <Badge variant="muted">None · 0</Badge>
            <Badge variant="success">Low</Badge>
            <Badge variant="warning">Medium</Badge>
            <Badge variant="destructive">High</Badge>
            {cellFilter ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCellFilter(null)}
              >
                Clear cell filter ({cellFilter.role} × {cellFilter.competency})
              </Button>
            ) : null}
          </div>

          {competencies.length === 0 ? (
            <EmptyState
              title="No competency gaps to plot"
              description="Employees are present but competency_gaps arrays are empty."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--surface-raised)] p-2 text-left font-medium">
                      Role \ FSF
                    </th>
                    {competencies.map((c) => (
                      <th
                        key={c}
                        className="min-w-[88px] p-2 text-center font-mono font-medium"
                        title={c}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role} className="border-t border-[var(--border)]">
                      <th className="sticky left-0 z-10 bg-[var(--surface-raised)] p-2 text-left font-medium">
                        {role}
                      </th>
                      {competencies.map((comp) => {
                        const cell = cellLookup.get(`${role}||${comp}`);
                        const count = cell?.count ?? 0;
                        const risk = riskLevel(count, maxCount);
                        const selected =
                          cellFilter?.role === role &&
                          cellFilter?.competency === comp;
                        return (
                          <td key={comp} className="p-1">
                            <button
                              type="button"
                              className={cn(
                                "flex h-14 w-full flex-col items-center justify-center rounded-md border px-1 transition-colors",
                                risk.tone,
                                selected
                                  ? "border-[var(--primary)] ring-[3px] ring-[var(--focus-ring)]"
                                  : "border-transparent hover:border-[var(--border-strong)]",
                              )}
                              onClick={() =>
                                setCellFilter(
                                  selected
                                    ? null
                                    : { role, competency: comp },
                                )
                              }
                              aria-label={`${role} × ${comp}: ${risk.label}`}
                            >
                              <span className="font-semibold">{risk.label}</span>
                              {cell?.avgGap != null ? (
                                <span className="opacity-80">
                                  ΔL {cell.avgGap.toFixed(1)}
                                </span>
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Employees</CardTitle>
          <CardDescription>
            {tableEmployees.length} row
            {tableEmployees.length === 1 ? "" : "s"}
            {cellFilter
              ? ` filtered by ${cellFilter.role} × ${cellFilter.competency}`
              : ""}
            . Click a row to open the employee drawer. Dot = gap severity (High /
            Medium / Low).
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted-foreground)]">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className={cn(
                          "px-3 py-2 align-middle font-medium",
                          h.column.id === "levels" && "w-[5.5rem] text-right",
                          (h.column.id === "unit" ||
                            h.column.id === "location") &&
                            "w-[9rem]",
                        )}
                      >
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
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-3 py-8 text-center align-middle text-[var(--muted-foreground)]"
                    >
                      No employees match the current filters.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--surface)]"
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
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3 py-2.5 align-middle",
                            cell.column.id === "levels" && "text-right",
                            (cell.column.id === "unit" ||
                              cell.column.id === "location") &&
                              "max-w-[9rem]",
                            cell.column.id === "unit" && "align-top",
                            cell.column.id === "location" && "overflow-hidden",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
