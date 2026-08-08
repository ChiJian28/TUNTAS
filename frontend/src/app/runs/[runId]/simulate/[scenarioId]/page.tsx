import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { SimulationTheatre } from "@/features/simulation/simulation-theatre";

type PageProps = {
  params: Promise<{ runId: string; scenarioId: string }>;
};

export default async function SimulatePage({ params }: PageProps) {
  const { runId, scenarioId } = await params;
  return (
    <Suspense
      fallback={
        <div className="min-h-screen space-y-4 bg-[var(--background)] p-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-[70vh] w-full" />
        </div>
      }
    >
      <SimulationTheatre runId={runId} scenarioId={scenarioId} />
    </Suspense>
  );
}
