import { ReviewShell } from "@/features/review/review-shell";
import { ProcurementDossier } from "@/features/review/procurement-dossier";

export default async function ProcurementReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <ReviewShell runId={runId} gateKey="procurement">
      <ProcurementDossier runId={runId} />
    </ReviewShell>
  );
}
