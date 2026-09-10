import { Suspense, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
