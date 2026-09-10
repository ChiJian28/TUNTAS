import type { ReviewGateKey } from "@/lib/api/generated/openapi.types";

export const REVIEW_GATES = [
  { key: "compliance" as const, label: "Compliance", slug: "compliance" },
  { key: "procurement" as const, label: "Procurement", slug: "procurement" },
  { key: "learning" as const, label: "Learning", slug: "learning" },
  { key: "operations" as const, label: "Operations", slug: "operations" },
  { key: "management" as const, label: "Management", slug: "management" },
] as const;

export type ReviewSlug = (typeof REVIEW_GATES)[number]["slug"];

export function reviewHref(runId: string, key: ReviewGateKey | string) {
  return `/runs/${runId}/review/${key}`;
}

export function gateStatusTone(
  status: string,
): "success" | "warning" | "destructive" | "muted" | "soft-primary" {
  switch (status) {
    case "approved":
      return "success";
    case "active":
      return "soft-primary";
    case "rejected":
      return "destructive";
    case "skipped":
      return "muted";
    default:
      return "warning";
  }
}
