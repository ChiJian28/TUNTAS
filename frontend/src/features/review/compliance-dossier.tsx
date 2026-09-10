"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DiagnosticHeatmap } from "@/features/diagnostic/heatmap";
import { findHandoff } from "@/features/review/find-handoff";
import { apiQueries } from "@/lib/api/queries";
import { TuntasApiError } from "@/lib/api/errors";
import {
  diagnosticPayloadSchema,
  parseHandoffEnvelope,
  policyPayloadSchema,
  safeParsePayload,
} from "@/lib/schemas/payloads";

function text(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function ComplianceDossier({ runId }: { runId: string }) {
  const gates = useQuery(apiQueries.gates(runId));
  const handoffs = useQuery(apiQueries.handoffs(runId, true));
  const circular = gates.data?.path === "circular";
  const brief = useQuery({
    ...apiQueries.impactBrief(runId),
    enabled: circular,
  });

  const policy = findHandoff(handoffs.data ?? [], "policy");
  const diagnostic = findHandoff(handoffs.data ?? [], "diagnostic");
  const policyEnv = policy ? parseHandoffEnvelope(policy.output_json) : null;
  const diagEnv = diagnostic
    ? parseHandoffEnvelope(diagnostic.output_json)
    : null;
  const mappings =
    policyEnv?.ok
      ? safeParsePayload(policyPayloadSchema, policyEnv.data.payload)
      : null;
  const diag =
    diagEnv?.ok
      ? safeParsePayload(diagnosticPayloadSchema, diagEnv.data.payload)
      : null;

  const controlMappings = mappings?.ok
    ? mappings.data.control_mappings ?? []
    : [];

  if (brief.isError) {
    const err = brief.error as TuntasApiError;
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={err.endpoint}
      />
    );
  }

  return (
    <div className="space-y-6">
      {circular ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Expected vs Found
            </CardTitle>
            <CardDescription>
              Gold comparison for OR-TC 2026/1. Membership is graph + gold, not
              an LLM guess.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {brief.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <p className="text-sm font-medium">{brief.data?.headline}</p>
                <div className="grid gap-2 sm:grid-cols-4">
                  {(
                    [
                      "stale_programs",
                      "affected_employees",
                      "green_programs",
                    ] as const
                  ).map((k) => {
                    const row = brief.data?.expected_vs_found?.[k] as
                      | { expected?: number; found?: number; match?: boolean }
                      | undefined;
                    const label =
                      k === "stale_programs"
                        ? "Stale programmes"
                        : k === "affected_employees"
                          ? "Affected staff"
                          : "Stay green";
                    return (
                      <div
                        key={k}
                        className="rounded-xl border border-[var(--border)] p-3"
                      >
                        <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {label}
                        </p>
                        <p className="font-mono text-sm">
                          {row?.found ?? "—"} / {row?.expected ?? "—"}
                        </p>
                        <Badge variant={row?.match ? "success" : "destructive"}>
                          {row?.match ? "match" : "mismatch"}
                        </Badge>
                      </div>
                    );
                  })}
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      FP / FN
                    </p>
                    <p className="font-mono text-sm">
                      {Array.isArray(
                        brief.data?.expected_vs_found?.false_positives,
                      )
                        ? brief.data.expected_vs_found.false_positives.length
                        : 0}
                      {" / "}
                      {Array.isArray(
                        brief.data?.expected_vs_found?.false_negatives,
                      )
                        ? brief.data.expected_vs_found.false_negatives.length
                        : 0}
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Stale programmes
                    </p>
                    <ul className="space-y-1 text-sm">
                      {(brief.data?.stale_courses ?? []).map((c) => (
                        <li key={text(c.code)} className="font-mono text-xs">
                          {text(c.code)} · {text(c.clause_ref)} · {text(c.title)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Must stay green
                    </p>
                    <ul className="space-y-1 text-sm">
                      {(brief.data?.green_courses ?? []).map((c) => (
                        <li key={text(c.code)} className="font-mono text-xs">
                          {text(c.code)} · {text(c.title)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Affected staff
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(brief.data?.affected_employees ?? []).map((e) => (
                      <Badge key={text(e.employee_ref)} variant="warning">
                        {text(e.pseudonym) !== "—"
                          ? text(e.pseudonym)
                          : text(e.employee_ref)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Link
                  href={`/runs/${runId}/evidence?framework=BNM_ORTC_2026&blast=1`}
                  className="text-sm text-[var(--link)] underline"
                >
                  Trace clause → course → employee on Evidence Spine
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Policy mapping
          </CardTitle>
          <CardDescription>
            From Policy Compiler handoff — clause → control → competency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {handoffs.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : controlMappings.length === 0 ? (
            <EmptyState
              title="No control mappings"
              description="Policy Compiler handoff has not landed, or payload has no control_mappings."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="pb-2 pr-3">Clause</th>
                    <th className="pb-2 pr-3">Control</th>
                    <th className="pb-2 pr-3">Competencies</th>
                    <th className="pb-2">Citation</th>
                  </tr>
                </thead>
                <tbody>
                  {controlMappings.map((m, i) => (
                    <tr
                      key={`${text(m.clause_ref)}-${i}`}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="py-2 pr-3 font-mono">{text(m.clause_ref)}</td>
                      <td className="py-2 pr-3">
                        <span className="font-mono">{text(m.control_code)}</span>
                        <span className="block text-[var(--muted-foreground)]">
                          {text(m.control_name)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {Array.isArray(m.competency_codes)
                          ? m.competency_codes.map(String).join(", ")
                          : "—"}
                      </td>
                      <td className="py-2 text-[var(--muted-foreground)]">
                        {text(m.citation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mappings?.ok && mappings.data.nsc07_tc17_note ? (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              {mappings.data.nsc07_tc17_note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {diag?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Diagnostic</CardTitle>
            <CardDescription>{diag.data.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {diag.data.cohort_risk_statement ? (
              <p>{diag.data.cohort_risk_statement}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <DiagnosticHeatmap runId={runId} />
    </div>
  );
}
