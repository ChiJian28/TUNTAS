import { redirect } from "next/navigation";

export default async function ReviewIndexPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  redirect(`/runs/${runId}/review/compliance`);
}
