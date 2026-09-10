"use client";

import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const EvidenceCanvas = dynamic(
  () =>
    import("@/features/evidence/evidence-canvas").then((m) => m.EvidenceCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center p-6">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    ),
  },
);

function EvidenceContent() {
  const params = useParams<{ runId: string }>();
  const searchParams = useSearchParams();
  const framework = searchParams.get("framework") || "BNM_ORTC_2026";
  const autoBlast = searchParams.get("blast") === "1";
  return (
    <EvidenceCanvas
      runId={params.runId}
      framework={framework}
      autoBlast={autoBlast}
    />
  );
}

export default function EvidencePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center p-6">
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      }
    >
      <EvidenceContent />
    </Suspense>
  );
}
