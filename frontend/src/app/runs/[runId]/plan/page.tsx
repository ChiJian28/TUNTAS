"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalGate } from "@/features/approval/approval-gate";
import { DiagnosticHeatmap } from "@/features/diagnostic/heatmap";
import { OptionCards } from "@/features/portfolios/option-cards";
import { VendorChallengerPanel } from "@/features/portfolios/vendor-challenger-panel";
import { WhatIfPanel } from "@/features/portfolios/what-if-panel";
import { EmployeeDrawer } from "@/features/runs/employee-drawer";
import { apiQueries } from "@/lib/api/queries";
import { DISCLAIMER } from "@/lib/constants/agents";
import { formatMyr } from "@/lib/format/money";
import { formatRatioPercent } from "@/lib/format/score";
import { formatKlShort } from "@/lib/format/time";

const PLAN_TABS = ["decision", "diagnostics", "audit"] as const;
type PlanTab = (typeof PLAN_TABS)[number];

function parsePlanTab(raw: string | null): PlanTab {
  if (raw && (PLAN_TABS as readonly string[]).includes(raw)) {
    return raw as PlanTab;
  }
  return "decision";
}

function PlanContent() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parsePlanTab(searchParams.get("tab"));

  const cockpit = useQuery(apiQueries.cockpit(runId));
  const approvalHistory = useQuery(apiQueries.approvals(runId));

  const req = cockpit.data?.request;
  const status = cockpit.data?.run.status;
  const mode: "decision" | "resume" =
    status === "needs_policy_recompile" ||
    ((approvalHistory.data?.length ?? 0) > 0 && status === "awaiting_approval")
      ? "resume"
      : "decision";

  const setTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "decision") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="font-display text-3xl text-[var(--foreground)]">
          Capability plan & decision rail
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">{DISCLAIMER}</p>
        {req ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {req.synthetic ? <Badge variant="warning">Demo Data</Badge> : null}
            {req.source ? (
              <Badge variant="muted">Source: {req.source}</Badge>
            ) : null}
            {req.max_budget_per_employee_myr != null ? (
              <Badge variant="muted">
                Cap {formatMyr(req.max_budget_per_employee_myr)}
              </Badge>
            ) : null}
            {req.total_budget_myr != null ? (
              <Badge variant="muted">
                Total {formatMyr(req.total_budget_myr)}
              </Badge>
            ) : null}
            {req.min_operational_coverage_ratio != null ? (
              <Badge variant="muted">
                Coverage{" "}
                {formatRatioPercent(req.min_operational_coverage_ratio).text}
              </Badge>
            ) : null}
            {req.training_window_start && req.training_window_end ? (
              <Badge variant="muted">
                {formatKlShort(req.training_window_start)} →{" "}
                {formatKlShort(req.training_window_end)}
              </Badge>
            ) : null}
            {req.frameworks?.map((f) => (
              <Badge key={f} variant="evidence">
                {f}
              </Badge>
            ))}
            {req.employee_count ? (
              <Badge variant="muted">{req.employee_count} employees</Badge>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">
            Constraint header unavailable (no RunRequestSummary on cockpit).
          </p>
        )}
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="decision" className="px-3">
                Decision Rail
              </TabsTrigger>
              <TabsTrigger value="diagnostics" className="px-3">
                Diagnostics
              </TabsTrigger>
              <TabsTrigger value="audit" className="px-3">
                Audit Trail
              </TabsTrigger>
            </TabsList>

            <TabsContent value="decision" className="mt-5 space-y-6">
              <OptionCards runId={runId} />
            </TabsContent>

            <TabsContent value="diagnostics" className="mt-5 space-y-6">
              <DiagnosticHeatmap runId={runId} />
            </TabsContent>

            <TabsContent value="audit" className="mt-5 space-y-6">
              <VendorChallengerPanel runId={runId} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
          <WhatIfPanel runId={runId} />
          <ApprovalGate runId={runId} mode={mode} />
        </aside>
      </div>

      <EmployeeDrawer runId={runId} />
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <PlanContent />
    </Suspense>
  );
}
