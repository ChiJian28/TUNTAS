import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { AuditWorkspace } from "@/features/audit/audit-workspace";

type PageProps = {
  params: Promise<{ runId: string }>;
};

export default async function AuditPage({ params }: PageProps) {
  const { runId } = await params;
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-96 w-full" />
        </div>
      }
    >
      <AuditWorkspace runId={runId} />
    </Suspense>
  );
}
