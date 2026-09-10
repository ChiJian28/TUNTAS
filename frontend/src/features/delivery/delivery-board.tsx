"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EventClickArg } from "@fullcalendar/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { apiQueries } from "@/lib/api/queries";
import { TuntasApiError } from "@/lib/api/errors";
import { ArtifactShelf } from "@/features/delivery/artifact-shelf";
import { DeliveryLock } from "@/features/delivery/delivery-lock";
import {
  EmployeeDrawer,
  openEmployeeInUrl,
} from "@/features/runs/employee-drawer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKlShort } from "@/lib/format/time";
import { formatMyr } from "@/lib/format/money";
import { useUiStore } from "@/stores/ui-store";

const FullCalendar = dynamic(() => import("@fullcalendar/react"), { ssr: false });
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";

const LOCKED_STATUSES = new Set([
  "created",
  "running",
  "awaiting_approval",
  "revising",
  "rejected",
  "failed",
  "needs_policy_recompile",
]);

export function DeliveryBoard({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setEmployeeDrawerRef = useUiStore((s) => s.setEmployeeDrawerRef);

  const cockpit = useQuery(apiQueries.cockpit(runId));
  const sessions = useQuery(apiQueries.sessions(runId));
  const assignments = useQuery(apiQueries.assignments(runId));
  const artifacts = useQuery(apiQueries.artifacts(runId));

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const status = cockpit.data?.run.status;
  const sessionList = useMemo(
    () => sessions.data ?? cockpit.data?.sessions ?? [],
    [sessions.data, cockpit.data?.sessions],
  );
  const assignmentList = assignments.data ?? [];
  const artifactList = artifacts.data ?? cockpit.data?.artifacts ?? [];

  // Pre-COMMIT statuses stay locked even if a previous cycle left sessions behind.
  const locked =
    status == null ||
    LOCKED_STATUSES.has(status) ||
    status === "approved_processing";

  const events = useMemo(
    () =>
      sessionList.map((s) => ({
        id: s.id,
        title: `${s.course_code} · ${s.title}`,
        start: s.starts_at,
        end: s.ends_at,
        extendedProps: s,
      })),
    [sessionList],
  );

  const filteredAssignments = selectedSessionId
    ? assignmentList.filter((a) => a.session_id === selectedSessionId)
    : assignmentList;

  if (cockpit.isLoading || sessions.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (cockpit.isError) {
    const err = cockpit.error as TuntasApiError;
    return <ErrorState message={err.message} status={err.status} />;
  }

  if (locked) {
    return <DeliveryLock status={status} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Q3 calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="tuntas-calendar rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,timeGridWeek,listWeek",
              }}
              timeZone="Asia/Kuala_Lumpur"
              editable={false}
              droppable={false}
              events={events}
              eventClick={(info: EventClickArg) => {
                setSelectedSessionId(info.event.id);
              }}
              height="auto"
            />
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Read-only — drag reschedule is disabled. Time zone: Asia/Kuala_Lumpur.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Capacity / coverage ledger</CardTitle>
            <Badge variant="muted" className="font-mono text-[10px]">
              {sessionList.length} session{sessionList.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            Unit/day coverage conflicts and prerequisite order:{" "}
            <Badge variant="muted" className="align-middle">
              Not exposed
            </Badge>{" "}
            by current API fields — no green badge invented. Enrolled headcount is
            only shown when present in session metadata; otherwise assigned count
            from{" "}
            <span className="font-mono">GET …/assignments</span> is used.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {sessionList.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No sessions returned for this run.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)]">
              <div className="max-h-[min(320px,50vh)] overflow-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="sticky top-0 z-[1] bg-[var(--surface)] text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                    <tr>
                      <th className="border-b border-[var(--border)] px-3 py-2 font-medium">
                        Course
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 font-medium">
                        Session
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 font-medium">
                        Window
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium">
                        Capacity
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium">
                        Assigned
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 text-right font-medium">
                        Enrolled
                      </th>
                      <th className="border-b border-[var(--border)] px-3 py-2 font-medium">
                        Fill
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sessionList.map((s) => {
                      const assigned = assignmentList.filter(
                        (a) => a.session_id === s.id,
                      ).length;
                      const enrolledRaw = s.metadata?.enrolled;
                      const enrolled =
                        typeof enrolledRaw === "number" ? enrolledRaw : null;
                      const fillBase = enrolled ?? assigned;
                      const fillRatio =
                        s.capacity > 0 ? Math.min(1, fillBase / s.capacity) : 0;
                      const over =
                        s.capacity > 0 && fillBase > s.capacity;

                      return (
                        <tr
                          key={s.id}
                          className="bg-[var(--surface-raised)] hover:bg-[var(--surface-emphasis)]/60"
                        >
                          <td className="px-3 py-2 align-middle font-mono text-[11px] text-[var(--foreground)]">
                            {s.course_code}
                          </td>
                          <td className="max-w-[12rem] truncate px-3 py-2 align-middle text-xs text-[var(--body)]">
                            {s.title}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-[11px] text-[var(--muted-foreground)]">
                            {formatKlShort(s.starts_at)}
                          </td>
                          <td className="px-3 py-2 text-right align-middle font-mono text-xs tabular-nums">
                            {s.capacity}
                          </td>
                          <td className="px-3 py-2 text-right align-middle font-mono text-xs tabular-nums">
                            {assigned}
                          </td>
                          <td className="px-3 py-2 text-right align-middle">
                            {enrolled != null ? (
                              <span className="font-mono text-xs tabular-nums">
                                {enrolled}
                              </span>
                            ) : (
                              <Badge
                                variant="muted"
                                className="text-[10px] font-normal"
                              >
                                Not exposed
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <div className="flex min-w-[4.5rem] items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
                                <div
                                  className={
                                    over
                                      ? "h-full rounded-full bg-[var(--destructive)]"
                                      : "h-full rounded-full bg-[var(--evidence)]"
                                  }
                                  style={{
                                    width: `${Math.round(fillRatio * 100)}%`,
                                  }}
                                />
                              </div>
                              <span
                                className={
                                  over
                                    ? "font-mono text-[10px] tabular-nums text-[var(--destructive)]"
                                    : "font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]"
                                }
                              >
                                {s.capacity > 0
                                  ? `${Math.round(fillRatio * 100)}%`
                                  : "—"}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Assignments
            {selectedSessionId ? (
              <button
                type="button"
                className="ml-2 text-xs text-[var(--link)] underline"
                onClick={() => setSelectedSessionId(null)}
              >
                clear session filter
              </button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.isError ? (
            <ErrorState message={(assignments.error as Error).message} />
          ) : filteredAssignments.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No assignments.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs text-[var(--muted-foreground)]">
                  <tr>
                    <th className="p-2">Employee</th>
                    <th className="p-2">Course</th>
                    <th className="p-2">Cost</th>
                    <th className="p-2">Session</th>
                    <th className="p-2">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((a) => (
                    <tr
                      key={a.id}
                      className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface)]"
                      onClick={() =>
                        openEmployeeInUrl(
                          router,
                          pathname,
                          searchParams,
                          a.employee_ref,
                          setEmployeeDrawerRef,
                        )
                      }
                    >
                      <td className="p-2 font-mono text-xs">{a.employee_ref}</td>
                      <td className="p-2 font-mono text-xs">{a.course_code}</td>
                      <td className="p-2 tabular-nums">{formatMyr(a.cost_myr)}</td>
                      <td className="p-2 text-xs">{a.session_title ?? a.session_id}</td>
                      <td className="p-2 font-mono text-[11px]">
                        {formatKlShort(a.starts_at)} → {formatKlShort(a.ends_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ArtifactShelf artifacts={artifactList} />
      <EmployeeDrawer runId={runId} />
    </div>
  );
}
