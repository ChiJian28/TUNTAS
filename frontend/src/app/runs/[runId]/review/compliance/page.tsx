import { ReviewShell } from "@/features/review/review-shell";
import { ComplianceDossier } from "@/features/review/compliance-dossier";

export default async function ComplianceReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <ReviewShell runId={runId} gateKey="compliance">
      <ComplianceDossier runId={runId} />
    </ReviewShell>
  );
}
