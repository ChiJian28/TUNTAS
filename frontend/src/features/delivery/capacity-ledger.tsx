"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ScheduleAssignmentView,
  TrainingSessionView,
} from "@/lib/api/generated/openapi.types";

type CapacityLedgerProps = {
  sessions: TrainingSessionView[];
  assignments: ScheduleAssignmentView[];
};

function readMeta(
  metadata: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const k of keys) {
    if (metadata[k] != null) return metadata[k];
  }
  return undefined;
}

export function CapacityLedger({ sessions, assignments }: CapacityLedgerProps) {
  const enrolledBySession = new Map<string, number>();
  for (const a of assignments) {
    enrolledBySession.set(
      a.session_id,
      (enrolledBySession.get(a.session_id) ?? 0) + 1,
    );
  }

  const hasUnitDayCoverage = sessions.some((s) =>
    readMeta(s.metadata ?? {}, [
      "unit_day_coverage",
      "operational_coverage",
      "coverage_by_unit",
    ]),
  );
  const hasConflicts = sessions.some(
    (s) => readMeta(s.metadata ?? {}, ["conflicts", "conflict_count"]) != null,
  );
  const hasPrereqOrder = sessions.some(
    (s) =>
      readMeta(s.metadata ?? {}, [
        "prerequisite_order_ok",
        "prerequisites_ok",
      ]) != null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Capacity & coverage ledger</CardTitle>
        <CardDescription>
          Only fields present on session metadata are shown. Missing backend
          fields are labelled Not exposed — no invented green badges.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] p-3">
            <dt className="text-[var(--muted-foreground)]">
              Unit / day coverage
            </dt>
            <dd className="mt-1 font-medium">
              {hasUnitDayCoverage ? "See session metadata" : "Not exposed"}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <dt className="text-[var(--muted-foreground)]">Conflicts</dt>
            <dd className="mt-1 font-medium">
              {hasConflicts ? "See session metadata" : "Not exposed"}
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <dt className="text-[var(--muted-foreground)]">
              Prerequisite order
            </dt>
            <dd className="mt-1 font-medium">
              {hasPrereqOrder ? "See session metadata" : "Not exposed"}
            </dd>
          </div>
        </dl>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)] text-left text-xs text-[var(--muted-foreground)]">
              <tr>
                <th className="px-3 py-2">Session</th>
                <th className="px-3 py-2">Capacity</th>
                <th className="px-3 py-2">Enrolled (from assignments)</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-[var(--muted-foreground)]"
                  >
                    No sessions.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => {
                  const enrolled = enrolledBySession.get(s.id) ?? 0;
                  const metaEnrolled = readMeta(s.metadata ?? {}, [
                    "enrolled",
                    "enrolled_count",
                  ]);
                  const enrolledLabel =
                    typeof metaEnrolled === "number"
                      ? `${metaEnrolled} (metadata)`
                      : `${enrolled} (assignment count)`;
                  const over =
                    typeof s.capacity === "number" && enrolled > s.capacity;
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{s.title}</div>
                        <div className="font-mono text-xs text-[var(--muted-foreground)]">
                          {s.course_code}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{s.capacity}</td>
                      <td className="px-3 py-2 tabular-nums">{enrolledLabel}</td>
                      <td className="px-3 py-2">
                        {over
                          ? "enrolled > capacity (from assignment count)"
                          : "Within capacity (assignment count vs capacity)"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
