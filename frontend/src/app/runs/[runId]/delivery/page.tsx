"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { DeliveryBoard } from "@/features/delivery/delivery-board";

function DeliveryContent() {
  const params = useParams<{ runId: string }>();
  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl tracking-tight">Delivery</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Q3 schedule, assignments, capacity ledger, and native artifacts —
          unlocked only after real approval commit. Deep-link{" "}
          <span className="font-mono">?employee=</span>.
        </p>
      </header>
      <DeliveryBoard runId={params.runId} />
    </div>
  );
}

export default function DeliveryPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <DeliveryContent />
    </Suspense>
  );
}
