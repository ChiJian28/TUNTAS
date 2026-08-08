"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, ChevronDown, ExternalLink } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_PIPELINE } from "@/lib/constants/agents";
import { normalizeApiError } from "@/lib/api/errors";
import type { AgentHandoffView } from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import { formatMyr } from "@/lib/format/money";
import { formatKl } from "@/lib/format/time";
import { cn } from "@/lib/utils";
import {
  challengerPayloadSchema,
  displayOrUnknown,
  isSafeHttpUrl,
  parseHandoffEnvelope,
  safeParsePayload,
  vendorCourseSchema,
  vendorPayloadSchema,
} from "@/lib/schemas/payloads";

function matchAgent(handoff: AgentHandoffView, names: readonly string[]) {
  const n = handoff.agent_name.toLowerCase();
  return names.some((name) => n.includes(name.toLowerCase()));
}

function findHandoff(
  handoffs: AgentHandoffView[],
  pipelineId: "vendor" | "challenger",
) {
  const entry = AGENT_PIPELINE.find((a) => a.id === pipelineId);
  const names = entry && "agentNames" in entry ? entry.agentNames : [];
  return handoffs.find((h) => matchAgent(h, names)) ?? null;
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[var(--border)] pb-1.5">
      <dt className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="min-w-0 text-right font-mono text-xs font-medium tabular-nums text-[var(--foreground)] font-[family-name:var(--font-mono)]">
        {displayOrUnknown(value)}
      </dd>
    </div>
  );
}

/** Progressive disclosure — long dossiers stay collapsed by default. */
function Disclosure({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-emphasis)]"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {title}
          </span>
          {count != null ? (
            <Badge variant="muted" className="font-mono text-[10px]">
              {count}
            </Badge>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface-raised)] p-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Prefer envelope.payload; fall back to envelope root / full output when courses live there. */
function parseVendorPayload(handoff: AgentHandoffView) {
  const env = parseHandoffEnvelope(handoff.output_json);
  if (!env.ok) {
    return { kind: "bad_envelope" as const, raw: handoff.output_json };
  }

  const attempts: unknown[] = [
    env.data.payload,
    env.data,
    handoff.output_json,
  ];

  for (const candidate of attempts) {
    if (candidate == null) continue;
    const payload = safeParsePayload(vendorPayloadSchema, candidate);
    if (
      payload.ok &&
      ((payload.data.courses?.length ?? 0) > 0 ||
        payload.data.shortlist_notes ||
        (payload.data.live_evidence?.length ?? 0) > 0 ||
        payload.data.mode_used)
    ) {
      return { kind: "ok" as const, envelope: env.data, payload: payload.data };
    }
    if (payload.ok) {
      return { kind: "ok" as const, envelope: env.data, payload: payload.data };
    }
  }

  return {
    kind: "bad_payload" as const,
    raw: env.data.payload ?? env.data,
    envelope: env.data,
  };
}

export function VendorChallengerPanel({ runId }: { runId: string }) {
  const handoffsQuery = useQuery(apiQueries.handoffs(runId, true));

  const { vendorHandoff, challengerHandoff } = useMemo(() => {
    const list = handoffsQuery.data ?? [];
    return {
      vendorHandoff: findHandoff(list, "vendor"),
      challengerHandoff: findHandoff(list, "challenger"),
    };
  }, [handoffsQuery.data]);

  const vendorParsed = useMemo(
    () => (vendorHandoff ? parseVendorPayload(vendorHandoff) : null),
    [vendorHandoff],
  );

  const challengerParsed = useMemo(() => {
    if (!challengerHandoff) return null;
    const env = parseHandoffEnvelope(challengerHandoff.output_json);
    if (!env.ok) {
      return { kind: "bad_envelope" as const, raw: challengerHandoff.output_json };
    }
    const payload = safeParsePayload(challengerPayloadSchema, env.data.payload);
    if (!payload.ok) {
      const rootTry = safeParsePayload(
        challengerPayloadSchema,
        challengerHandoff.output_json,
      );
      if (rootTry.ok) {
        return {
          kind: "ok" as const,
          envelope: env.data,
          payload: rootTry.data,
        };
      }
      return {
        kind: "bad_payload" as const,
        raw: env.data.payload,
        envelope: env.data,
      };
    }
    return { kind: "ok" as const, envelope: env.data, payload: payload.data };
  }, [challengerHandoff]);

  if (handoffsQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (handoffsQuery.isError) {
    const err = normalizeApiError(handoffsQuery.error);
    return (
      <ErrorState
        message={err.message}
        status={err.status}
        endpoint={`/v1/runs/${runId}/handoffs`}
        onRetry={() => void handoffsQuery.refetch()}
      />
    );
  }

  const courses =
    vendorParsed?.kind === "ok" ? (vendorParsed.payload.courses ?? []) : [];
  const liveEvidence =
    vendorParsed?.kind === "ok"
      ? (vendorParsed.payload.live_evidence ?? [])
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Vendor &amp; Challenger</CardTitle>
        <CardDescription>
          Audit trail from agent handoffs (Zod-parsed). Expand sections for
          dossiers — missing fields stay Unknown, never coerced to 0.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Vendor intelligence</h3>
            {vendorParsed?.kind === "ok" && vendorParsed.payload.mode_used ? (
              <Badge variant="evidence">
                Source: {vendorParsed.payload.mode_used}
              </Badge>
            ) : null}
            {vendorHandoff ? (
              <Badge variant="muted" className="font-mono">
                {vendorHandoff.id.slice(0, 8)}…
              </Badge>
            ) : null}
          </div>

          {!vendorHandoff ? (
            <EmptyState
              title="Vendor handoff not available"
              description="No vendor_intelligence handoff in the latest-per-agent list yet."
              className="py-8"
            />
          ) : null}

          {vendorParsed?.kind === "bad_envelope" ||
          vendorParsed?.kind === "bad_payload" ? (
            <Disclosure title="Unrecognized vendor payload" defaultOpen>
              <Badge variant="warning">Schema not recognized</Badge>
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                {JSON.stringify(vendorParsed.raw, null, 2)}
              </pre>
            </Disclosure>
          ) : null}

          {vendorParsed?.kind === "ok" ? (
            <>
              {vendorParsed.payload.shortlist_notes ? (
                <p className="text-sm text-[var(--body)]">
                  {vendorParsed.payload.shortlist_notes}
                </p>
              ) : null}

              <Disclosure
                title="Course shortlist"
                count={courses.length}
                defaultOpen={courses.length > 0 && courses.length <= 3}
              >
                {courses.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No courses in vendor payload.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {courses.map((rawCourse, idx) => {
                      const parsed = safeParsePayload(
                        vendorCourseSchema,
                        rawCourse,
                      );
                      if (!parsed.ok) {
                        return (
                          <li
                            key={idx}
                            className="rounded-xl border border-[var(--border)] p-3"
                          >
                            <Badge variant="muted">Schema not recognized</Badge>
                            <pre className="mt-2 max-h-32 overflow-auto font-mono text-[10px] text-[var(--muted-foreground)]">
                              {JSON.stringify(parsed.raw, null, 2)}
                            </pre>
                          </li>
                        );
                      }
                      const c = parsed.data;
                      const code = c.course_code || c.code || "Unknown";
                      const rawPrice = c.price_myr ?? c.cost_myr;
                      const price =
                        typeof rawPrice === "number"
                          ? rawPrice
                          : typeof rawPrice === "string" &&
                              rawPrice.trim() !== "" &&
                              !Number.isNaN(Number(rawPrice))
                            ? Number(rawPrice)
                            : null;
                      const quoteRequired =
                        c.quote_required === true ||
                        c.price_status === "QUOTE_REQUIRED" ||
                        (Array.isArray(c.privacy_flags) &&
                          c.privacy_flags.includes("QUOTE_REQUIRED"));
                      const url = c.evidence_url || c.provider_website;
                      const capacity =
                        typeof c.class_capacity === "number"
                          ? c.class_capacity
                          : typeof c.class_capacity === "string"
                            ? c.class_capacity
                            : c.class_capacity;
                      return (
                        <li
                          key={`${code}-${idx}`}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--foreground)]">
                                {c.title || c.course || code}
                              </div>
                              <div className="text-xs text-[var(--muted-foreground)]">
                                {displayOrUnknown(
                                  c.provider_name || c.provider,
                                )}{" "}
                                · <span className="font-mono">{code}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {c.price_status ? (
                                <Badge variant="muted">{c.price_status}</Badge>
                              ) : (
                                <Badge variant="muted">
                                  Unknown price status
                                </Badge>
                              )}
                              {quoteRequired ? (
                                <Badge variant="warning">QUOTE_REQUIRED</Badge>
                              ) : null}
                              {c.source ? (
                                <Badge variant="evidence">{c.source}</Badge>
                              ) : null}
                            </div>
                          </div>
                          <dl className="mt-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-6">
                            <Field
                              label="Price (MYR)"
                              value={
                                price == null ? "Unknown" : formatMyr(price)
                              }
                            />
                            <Field label="Delivery" value={c.delivery_mode} />
                            <Field
                              label="HRD Corp"
                              value={
                                c.hrd_corp_claimable == null
                                  ? "Unknown"
                                  : c.hrd_corp_claimable
                                    ? "Claimable"
                                    : "Not claimable"
                              }
                            />
                            <Field
                              label="Data residency"
                              value={c.data_residency}
                            />
                            <Field
                              label="Evidence freshness"
                              value={c.evidence_freshness}
                            />
                            <Field label="Class capacity" value={capacity} />
                            <Field
                              label="Q3 availability"
                              value={
                                c.q3_availability == null
                                  ? "Unknown"
                                  : String(c.q3_availability)
                              }
                            />
                            <Field
                              label="Prerequisites"
                              value={
                                (
                                  c.prerequisite_codes ?? c.prerequisites
                                )?.join(", ") || "Unknown"
                              }
                            />
                          </dl>
                          {isSafeHttpUrl(url) ? (
                            <a
                              href={url!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--link)] hover:underline"
                            >
                              Evidence / provider link
                              <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : url ? (
                            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                              Unsafe URL withheld
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Disclosure>

              {liveEvidence.length > 0 ? (
                <Disclosure
                  title="Live evidence snippets"
                  count={liveEvidence.length}
                  defaultOpen={false}
                >
                  <ul className="space-y-2">
                    {liveEvidence.map((ev, i) => (
                      <li
                        key={i}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                      >
                        <div className="text-xs font-medium text-[var(--foreground)]">
                          {ev.title || "Untitled evidence"}
                        </div>
                        {ev.snippet ? (
                          <div className="relative mt-2 overflow-hidden rounded border border-[var(--border-strong)] bg-[var(--surface-raised)]">
                            <div
                              aria-hidden
                              className="absolute bottom-0 left-0 top-0 w-1 rounded-l bg-[var(--evidence)]"
                            />
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap p-3 pl-4 font-mono text-[10px] leading-relaxed text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                              {ev.snippet}
                            </pre>
                          </div>
                        ) : null}
                        {isSafeHttpUrl(ev.url) ? (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--link)] hover:underline"
                          >
                            Open source
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : null}
                        {ev.retrieved_at ? (
                          <p className="mt-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                            Retrieved {formatKl(ev.retrieved_at)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </>
          ) : null}
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Challenger red-team</h3>
            {challengerHandoff ? (
              <Badge variant="muted" className="font-mono">
                {challengerHandoff.id.slice(0, 8)}…
              </Badge>
            ) : null}
          </div>

          {!challengerHandoff ? (
            <EmptyState
              title="Challenger handoff not available"
              description="No challenger handoff in the latest-per-agent list yet."
              className="py-8"
            />
          ) : null}

          {challengerParsed?.kind === "ok" ? (
            <>
              {challengerParsed.payload.overall_recommendation ? (
                <p className="text-sm text-[var(--body)]">
                  {challengerParsed.payload.overall_recommendation}
                </p>
              ) : null}

              <FlagList
                title="Critical vetoes"
                items={challengerParsed.payload.vetoes ?? []}
                criticalOnly
              />

              <Disclosure
                title="Evidence insufficient"
                count={
                  (challengerParsed.payload.evidence_insufficient ?? []).length
                }
                defaultOpen={false}
              >
                <FlagList
                  title=""
                  items={challengerParsed.payload.evidence_insufficient ?? []}
                  hideHeading
                />
              </Disclosure>

              <Disclosure
                title="Option flags"
                count={(challengerParsed.payload.option_flags ?? []).length}
                defaultOpen={false}
              >
                <FlagList
                  title=""
                  items={challengerParsed.payload.option_flags ?? []}
                  hideHeading
                />
              </Disclosure>
            </>
          ) : null}

          {challengerParsed?.kind === "bad_envelope" ||
          challengerParsed?.kind === "bad_payload" ? (
            <Disclosure title="Unrecognized challenger payload" defaultOpen>
              <Badge variant="warning">Schema not recognized</Badge>
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                {JSON.stringify(challengerParsed.raw, null, 2)}
              </pre>
            </Disclosure>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function FlagList({
  title,
  items,
  criticalOnly = false,
  hideHeading = false,
}: {
  title: string;
  items: Array<{
    severity?: string;
    message?: string;
    reason?: string;
    course_code?: string;
    option_key?: string;
    flag?: string;
    code?: string;
    veto?: boolean;
  }>;
  criticalOnly?: boolean;
  hideHeading?: boolean;
}) {
  const shown = criticalOnly
    ? items.filter(
        (f) =>
          String(f.severity ?? "").toLowerCase() === "critical" ||
          f.veto === true,
      )
    : items;

  if (shown.length === 0) {
    return (
      <div>
        {!hideHeading && title ? (
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            {title}
          </h4>
        ) : null}
        <p
          className={cn(
            "text-sm text-[var(--muted-foreground)]",
            !hideHeading && title && "mt-1",
          )}
        >
          {criticalOnly
            ? "No critical veto returned by backend."
            : "None reported."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!hideHeading && title ? (
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
        </h4>
      ) : null}
      <ul className="space-y-2">
        {shown.map((f, i) => {
          const sev = String(f.severity ?? "").toLowerCase();
          const isCritical = sev === "critical" || f.veto === true;
          return (
            <li
              key={i}
              className={
                isCritical
                  ? "rounded-lg border border-[var(--destructive)]/40 border-l-[3px] border-l-[var(--destructive)] bg-[var(--destructive-soft)] p-3 text-sm"
                  : "rounded-lg border border-[var(--border)] p-3 text-sm"
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {isCritical ? (
                  <Badge
                    variant="destructive"
                    className="flex items-center gap-1.5 font-bold uppercase tracking-wider"
                  >
                    <AlertOctagon className="size-3.5" aria-hidden />
                    Critical Veto
                  </Badge>
                ) : f.severity ? (
                  <Badge variant="warning">{f.severity}</Badge>
                ) : (
                  <Badge variant="muted">Unknown severity</Badge>
                )}
                {f.course_code ? (
                  <Badge variant="muted" className="font-mono">
                    {f.course_code}
                  </Badge>
                ) : null}
                {f.option_key ? (
                  <Badge variant="soft-primary">{f.option_key}</Badge>
                ) : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[var(--body)]">
                {f.message || f.reason || f.flag || f.code || "No reason text"}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
