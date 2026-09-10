import { ReviewShell } from "@/features/review/review-shell";
import { OperationsDossier } from "@/features/review/operations-dossier";

export default async function OperationsReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <ReviewShell runId={runId} gateKey="operations">
      <OperationsDossier runId={runId} />
    </ReviewShell>
  );
}
