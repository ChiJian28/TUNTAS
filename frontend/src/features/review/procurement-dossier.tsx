"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VendorChallengerPanel } from "@/features/portfolios/vendor-challenger-panel";
import { apiQueries } from "@/lib/api/queries";

export function ProcurementDossier({ runId }: { runId: string }) {
  const gates = useQuery(apiQueries.gates(runId));
  const circular = gates.data?.path === "circular";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">
            {circular
              ? "In-force catalogue vs OR-TC"
              : "Vendor shortlist & Challenger"}
          </CardTitle>
          <CardDescription>
            {circular
              ? "Approve only if existing in-force vendors can cover the stale programmes without a new RFP. Challenger vetoes still apply — a veto is not a reason to buy a replacement vendor."
              : "Approve only if the shortlist and privacy vetoes match the pack. Critical Challenger vetoes still block Management COMMIT later."}
          </CardDescription>
        </CardHeader>
      </Card>
      <VendorChallengerPanel runId={runId} />
    </div>
  );
}
