import { Lock } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";

type DeliveryLockProps = {
  status?: string | null;
};

export function DeliveryLock({ status }: DeliveryLockProps) {
  return (
    <EmptyState
      icon={<Lock className="size-5" aria-hidden />}
      title="No commitment before management COMMIT"
      description={
        status
          ? `Department gates and Management COMMIT have not committed a schedule. Run status: ${status}. Sessions, assignments, and artifacts stay empty until POST /decision succeeds.`
          : "Department gates and Management COMMIT have not committed a schedule. Sessions, assignments, and artifacts stay empty until POST /decision succeeds."
      }
      className="min-h-[320px]"
    />
  );
}
