import { AssuranceWorkspace } from "@/features/assurance/assurance-workspace";

type PageProps = {
  params: Promise<{ runId: string }>;
};

export default async function AssurancePage({ params }: PageProps) {
  const { runId } = await params;
  return <AssuranceWorkspace runId={runId} />;
}
