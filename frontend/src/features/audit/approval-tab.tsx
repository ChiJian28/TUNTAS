"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";
import { CopyIdButton } from "@/features/audit/copy-id";
import { JsonViewer } from "@/features/agents/json-viewer";
import type { ApprovalDecisionView } from "@/lib/api/generated/openapi.types";
import { formatKl } from "@/lib/format/time";

type Props = {
  latest: ApprovalDecisionView | null | undefined;
  history: ApprovalDecisionView[];
};

function ApprovalCard({
  decision,
  title,
}: {
  decision: ApprovalDecisionView;
  title: string;
}) {
  const isApproved = decision.decision.toLowerCase().includes("approve");
  const isRejected = decision.decision.toLowerCase().includes("reject");

  return (
    <Card className="overflow-hidden border border-[var(--border-strong)] shadow-sm">
      <CardHeader className="border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-base font-semibold text-[var(--foreground)]">
            {title}
          </CardTitle>
          <Badge
            variant={
              isApproved ? "success" : isRejected ? "destructive" : "warning"
            }
            className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          >
            {decision.decision}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-5">
        <div className="border-l-2 border-[var(--foreground)] py-1 pl-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Human Rationale
          </p>
          <p className="text-[15px] font-medium leading-relaxed text-[var(--foreground)]">
            &ldquo;{decision.rationale}&rdquo;
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <dl className="grid grid-cols-[80px_1fr] gap-y-2.5 font-mono text-xs sm:grid-cols-[100px_1fr]">
            <dt className="text-[var(--muted-foreground)]">ID</dt>
            <dd className="flex items-center text-[var(--body)]">
              <CopyIdButton value={decision.id} label="Approval ID" />
            </dd>

            <dt className="text-[var(--muted-foreground)]">Actor</dt>
            <dd className="font-medium text-[var(--foreground)]">
              {decision.actor_id}{" "}
              <span className="ml-1 font-sans text-[11px] font-normal text-[var(--muted-foreground)]">
                ({decision.actor_role})
              </span>
            </dd>

            <dt className="text-[var(--muted-foreground)]">Option</dt>
            <dd className="text-[var(--foreground)]">
              <span className="font-semibold">{decision.option_key}</span>{" "}
              <span className="font-sans text-[var(--muted-foreground)]">
                — {decision.option_label}
              </span>
            </dd>

            <dt className="text-[var(--muted-foreground)]">Input Hash</dt>
            <dd className="flex items-center text-[var(--body)]">
              <CopyIdButton value={decision.input_hash} label="Input hash" />
            </dd>

            <dt className="text-[var(--muted-foreground)]">Created</dt>
            <dd className="text-[var(--body)]">
              {formatKl(decision.created_at)}
            </dd>
          </dl>
        </div>

        {Array.isArray(decision.conditions) &&
        decision.conditions.length > 0 ? (
          <div className="border-t border-dashed border-[var(--border)] pt-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Attached Conditions
            </p>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <JsonViewer
                data={decision.conditions}
                className="m-0 max-h-40 bg-[var(--surface)] p-3"
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ApprovalTab({ latest, history }: Props) {
  if (!latest && history.length === 0) {
    return (
      <EmptyState
        title="No approval decisions"
        description="HITL approve / revise / reject records will appear after a decision."
      />
    );
  }

  return (
    <div className="space-y-6">
      {latest ? (
        <ApprovalCard decision={latest} title="Latest approval" />
      ) : (
        <EmptyState
          title="No latest approval"
          description="GET /approval returned null."
        />
      )}

      <Separator />

      <div className="space-y-3">
        <h3 className="font-display text-lg text-[var(--foreground)]">
          Approval history
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            No historical approvals.
          </p>
        ) : (
          <div className="grid gap-3">
            {history.map((d) => (
              <ApprovalCard
                key={d.id}
                decision={d}
                title={`${d.option_key} · ${formatKl(d.created_at)}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
