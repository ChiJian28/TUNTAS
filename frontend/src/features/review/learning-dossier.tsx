"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import { findHandoff } from "@/features/review/find-handoff";
import { apiQueries } from "@/lib/api/queries";
import {
  learningPayloadSchema,
  parseHandoffEnvelope,
  safeParsePayload,
} from "@/lib/schemas/payloads";

function text(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export function LearningDossier({ runId }: { runId: string }) {
  const gates = useQuery(apiQueries.gates(runId));
  const handoffs = useQuery(apiQueries.handoffs(runId, true));
  const scenarios = useQuery(apiQueries.scenarios(runId));
  const brief = useQuery({
    ...apiQueries.impactBrief(runId),
    enabled: gates.data?.path === "circular",
  });

  const learning = findHandoff(handoffs.data ?? [], "learning");
  const env = learning ? parseHandoffEnvelope(learning.output_json) : null;
  const payload =
    env?.ok ? safeParsePayload(learningPayloadSchema, env.data.payload) : null;
  const modules = payload?.ok ? payload.data.curriculum_modules ?? [] : [];

  return (
    <div className="space-y-6">
      {gates.data?.path === "circular" ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Remediation pack — 3 programmes only
            </CardTitle>
            <CardDescription>
              L&amp;D must not expand blast radius. These codes come from the
              impact brief, not from semantic lookalikes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {brief.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <ul className="space-y-2 text-sm">
                {(brief.data?.stale_courses ?? []).map((c) => (
                  <li
                    key={text(c.code)}
                    className="rounded-lg border border-[var(--border)] px-3 py-2"
                  >
                    <span className="font-mono text-xs">{text(c.code)}</span>
                    <span className="ml-2">{text(c.title)}</span>
                    <Badge variant="warning" className="ml-2">
                      {text(c.clause_ref)}
                    </Badge>
                    {text(c.why_stale) !== "—" ? (
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {text(c.why_stale)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Curriculum modules
          </CardTitle>
          <CardDescription>
            Learning Architect handoff. Approve only if the path matches the
            gated impact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {handoffs.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : modules.length === 0 ? (
            <EmptyState
              title="No curriculum modules"
              description="Learning Architect has not persisted modules on this run."
            />
          ) : (
            <ul className="space-y-2">
              {modules.map((m, i) => (
                <li
                  key={`${text(m.module_code)}-${i}`}
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <p className="font-medium">
                    <span className="font-mono text-xs">{text(m.module_code)}</span>
                    {" · "}
                    {text(m.title)}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {text(m.delivery)} · L{text(m.level_from)}→L{text(m.level_to)} ·{" "}
                    {Array.isArray(m.competency_codes)
                      ? m.competency_codes.map(String).join(", ")
                      : "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            Scenarios & rubric
          </CardTitle>
          <CardDescription>
            Persisted scenario rows used later in Assurance. Approving this gate
            does not launch simulations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scenarios.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (scenarios.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="No scenarios"
              description="GET /scenarios is empty until Learning Architect persists them."
            />
          ) : (
            <ul className="space-y-3">
              {scenarios.data?.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <p className="text-sm font-medium">
                    <span className="font-mono text-xs">{s.code}</span> · {s.title}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Role focus: {s.role_focus}
                  </p>
                  {Array.isArray(s.rubric) && s.rubric.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {s.rubric.map((r, i) => (
                        <li key={i}>
                          {text(r.criterion)}
                          {r.critical ? (
                            <Badge variant="destructive" className="ml-2">
                              critical
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
