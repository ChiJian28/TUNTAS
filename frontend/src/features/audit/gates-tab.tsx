"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyIdButton } from "@/features/audit/copy-id";
import type { ReviewChainView } from "@/lib/api/generated/openapi.types";
import { gateStatusTone } from "@/lib/constants/gates";
import { formatKl } from "@/lib/format/time";

export function GatesTab({ chain }: { chain: ReviewChainView | null | undefined }) {
  if (!chain || chain.gates.length === 0) {
    return (
      <EmptyState
        title="No review chain"
        description="Department gates appear once the run reaches awaiting_approval. GET /v1/runs/{id}/gates."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="muted">Path: {chain.path}</Badge>
        <Badge variant="muted">Current: {chain.current_gate ?? "—"}</Badge>
        <Badge variant={chain.commit_unlocked ? "success" : "warning"}>
          {chain.commit_unlocked ? "COMMIT unlocked" : "COMMIT locked"}
        </Badge>
      </div>
      {chain.gates.map((g) => (
        <Card key={g.gate_key}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">
              Gate {g.sequence} · {g.label}
            </CardTitle>
            <Badge variant={gateStatusTone(g.status)}>{g.status}</Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-[var(--muted-foreground)]">{g.prompt}</p>
            <dl className="grid grid-cols-[100px_1fr] gap-y-1 font-mono text-xs">
              <dt className="text-[var(--muted-foreground)]">Decision</dt>
              <dd>{g.decision ?? "—"}</dd>
              <dt className="text-[var(--muted-foreground)]">Actor</dt>
              <dd>
                {g.actor_id ?? "—"}
                {g.actor_role ? ` (${g.actor_role})` : ""}
              </dd>
              <dt className="text-[var(--muted-foreground)]">At</dt>
              <dd>{g.decided_at ? formatKl(g.decided_at) : "—"}</dd>
              <dt className="text-[var(--muted-foreground)]">Hash</dt>
              <dd>
                {g.input_hash ? (
                  <CopyIdButton value={g.input_hash} label="Gate input hash" />
                ) : (
                  "—"
                )}
              </dd>
            </dl>
            {g.rationale ? (
              <p className="border-l-2 border-[var(--border-strong)] pl-3 italic">
                “{g.rationale}”
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
