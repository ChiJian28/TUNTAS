"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { ApprovalGate } from "@/features/approval/approval-gate";
import { OptionCards } from "@/features/portfolios/option-cards";
import { ReviewShell } from "@/features/review/review-shell";
import { apiQueries } from "@/lib/api/queries";
import {
  parseHandoffEnvelope,
  safeParsePayload,
  secretariatPayloadSchema,
} from "@/lib/schemas/payloads";
import { findHandoff } from "@/features/review/find-handoff";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ManagementReviewPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const cockpit = useQuery(apiQueries.cockpit(runId));
  const approvalHistory = useQuery(apiQueries.approvals(runId));
  const handoffs = useQuery(apiQueries.handoffs(runId, true));

  const status = cockpit.data?.run.status;
  const mode: "decision" | "resume" =
    status === "needs_policy_recompile" ||
    ((approvalHistory.data?.length ?? 0) > 0 && status === "awaiting_approval")
      ? "resume"
      : "decision";

  const secretariat = findHandoff(handoffs.data ?? [], "secretariat");
  const env = secretariat
    ? parseHandoffEnvelope(secretariat.output_json)
    : null;
  const brief =
    env?.ok
      ? safeParsePayload(secretariatPayloadSchema, env.data.payload)
      : null;

  return (
    <ReviewShell
      runId={runId}
      gateKey="management"
      aside={<ApprovalGate runId={runId} mode={mode} />}
    >
      {brief?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">
              Secretariat brief
            </CardTitle>
            <CardDescription>
              Agent recommendation. Humans still pick the option and COMMIT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{brief.data.decision_brief}</p>
            {brief.data.recommended_option_key ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                Recommended: {brief.data.recommended_option_key}
              </p>
            ) : null}
            {(brief.data.questions_for_manager ?? []).length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {brief.data.questions_for_manager?.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <OptionCards runId={runId} />
    </ReviewShell>
  );
}
