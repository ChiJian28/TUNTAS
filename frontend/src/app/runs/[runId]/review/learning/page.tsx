import { ReviewShell } from "@/features/review/review-shell";
import { LearningDossier } from "@/features/review/learning-dossier";

export default async function LearningReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <ReviewShell runId={runId} gateKey="learning">
      <LearningDossier runId={runId} />
    </ReviewShell>
  );
}
