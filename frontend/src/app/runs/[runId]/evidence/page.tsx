"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
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
  return <EvidenceCanvas runId={params.runId} />;
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
