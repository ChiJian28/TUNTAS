"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { apiQueries } from "@/lib/api/queries";
import { normalizeApiError } from "@/lib/api/errors";
import {
  competencyGapSchema,
  gapCode,
  gapLabel,
  safeParsePayload,
} from "@/lib/schemas/payloads";
import { formatKl } from "@/lib/format/time";
import { useUiStore } from "@/stores/ui-store";

type EmployeeDrawerProps = {
  runId: string;
};

export function EmployeeDrawer({ runId }: EmployeeDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const employeeFromUrl = searchParams.get("employee");
  const storeRef = useUiStore((s) => s.employeeDrawerRef);
  const setEmployeeDrawerRef = useUiStore((s) => s.setEmployeeDrawerRef);

  const employeeRef = employeeFromUrl ?? storeRef;

  const detailQuery = useQuery({
    ...apiQueries.employee(runId, employeeRef ?? ""),
    enabled: Boolean(employeeRef),
  });

  const open = Boolean(employeeRef);

  function close() {
    setEmployeeDrawerRef(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("employee");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const gaps = useMemo(() => {
    const raw = detailQuery.data?.competency_gaps ?? [];
    return raw.map((item) => safeParsePayload(competencyGapSchema, item));
  }, [detailQuery.data?.competency_gaps]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="fixed inset-y-0 right-0 left-auto top-0 flex h-full max-h-none w-full max-w-lg translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-[var(--border)] p-6 pb-4 text-left">
          <DialogTitle className="font-display text-xl">
            {detailQuery.data?.pseudonym ?? employeeRef ?? "Employee"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {employeeRef}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          {detailQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}

          {detailQuery.isError ? (
            <ErrorState
              message={normalizeApiError(detailQuery.error).message}
              status={normalizeApiError(detailQuery.error).status}
              endpoint={`/v1/runs/${runId}/employees/${employeeRef}`}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : null}

          {detailQuery.data ? (
            <div className="space-y-5 pb-8">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[var(--muted-foreground)]">Role</dt>
                  <dd>
                    {detailQuery.data.role_title ??
                      detailQuery.data.role_code ??
                      "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">Unit</dt>
                  <dd>{detailQuery.data.unit ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">Location</dt>
                  <dd>{detailQuery.data.location ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted-foreground)]">Levels</dt>
                  <dd>
                    {detailQuery.data.current_level ?? "?"} →{" "}
                    {detailQuery.data.target_level ?? "?"}
                  </dd>
                </div>
              </dl>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Competency gaps</h4>
                {gaps.length === 0 ? (
                  <EmptyState
                    title="No competency gaps"
                    description="API returned an empty competency_gaps array."
                    className="py-8"
                  />
                ) : (
                  <ul className="space-y-2">
                    {gaps.map((parsed, idx) => {
                      if (!parsed.ok) {
                        return (
                          <li
                            key={`raw-${idx}`}
                            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                          >
                            <Badge variant="muted">Schema not recognized</Badge>
                            <pre className="mt-2 overflow-x-auto font-mono">
                              {JSON.stringify(parsed.raw, null, 2)}
                            </pre>
                          </li>
                        );
                      }
                      const g = parsed.data;
                      const code = gapCode(g);
                      const priority = g.gap_priority ?? g.priority;
                      return (
                        <li
                          key={`${code}-${idx}`}
                          className="rounded-lg border border-[var(--border)] p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-[var(--evidence)]">
                              {code}
                            </span>
                            <span className="text-sm font-medium">
                              {gapLabel(g)}
                            </span>
                            {priority != null ? (
                              <Badge variant="warning">
                                Priority {String(priority)}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                            Level {g.current_level ?? "?"} →{" "}
                            {g.target_level ?? "?"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <Separator />

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Readiness</h4>
                {(detailQuery.data.readiness ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No readiness records.
                  </p>
                ) : (
                  <pre className="overflow-x-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-xs">
                    {JSON.stringify(detailQuery.data.readiness, null, 2)}
                  </pre>
                )}
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Assessments</h4>
                {(detailQuery.data.assessments ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No assessments.
                  </p>
                ) : (
                  <pre className="overflow-x-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-xs">
                    {JSON.stringify(detailQuery.data.assessments, null, 2)}
                  </pre>
                )}
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Schedule</h4>
                {(detailQuery.data.schedule ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No schedule committed for this employee.
                  </p>
                ) : (
                  <pre className="overflow-x-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-xs">
                    {JSON.stringify(detailQuery.data.schedule, null, 2)}
                  </pre>
                )}
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold">Simulation attempts</h4>
                {(detailQuery.data.simulation_attempts ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No Level 3 behaviour evidence yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {detailQuery.data.simulation_attempts.map((attempt, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-[var(--border)] p-3 font-mono text-xs"
                      >
                        <pre className="overflow-x-auto">
                          {JSON.stringify(attempt, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <p className="text-xs text-[var(--muted-foreground)]">
                Detail fetched from GET /v1/runs/…/employees/…
                {detailQuery.dataUpdatedAt
                  ? ` · ${formatKl(new Date(detailQuery.dataUpdatedAt).toISOString())}`
                  : ""}
              </p>
            </div>
          ) : null}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function openEmployeeInUrl(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: URLSearchParams,
  employeeRef: string,
  setStore: (ref: string | null) => void,
) {
  setStore(employeeRef);
  const params = new URLSearchParams(searchParams.toString());
  params.set("employee", employeeRef);
  router.replace(`${pathname}?${params.toString()}`, { scroll: false });
}
