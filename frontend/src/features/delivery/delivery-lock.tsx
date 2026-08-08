import { Lock } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

type DeliveryLockProps = {
  status?: string | null;
};

export function DeliveryLock({ status }: DeliveryLockProps) {
  return (
    <EmptyState
      icon={<Lock className="size-5" aria-hidden />}
      title="No commitment before approval"
      description={
        status
          ? `Awaiting management approval; no schedule has been committed. Run status: ${status}. Sessions, assignments, and artifacts are empty from the API — no preview calendar is invented.`
          : "Awaiting management approval; no schedule has been committed. Sessions, assignments, and artifacts are empty from the API — no preview calendar is invented."
      }
      className="min-h-[320px]"
    />
  );
}
