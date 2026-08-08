import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  status?: number;
  endpoint?: string;
  onRetry?: () => void;
}

function ErrorState({
  message,
  status,
  endpoint,
  onRetry,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive-soft)] p-6",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-[var(--destructive)]"
          aria-hidden
        />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium font-[family-name:var(--font-sans)] text-[var(--destructive)]">
            {message}
          </p>
          <dl className="space-y-1 text-xs font-[family-name:var(--font-mono)] text-[var(--body)]">
            {status != null ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-[var(--muted-foreground)]">Status</dt>
                <dd>{status}</dd>
              </div>
            ) : null}
            {endpoint ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="shrink-0 text-[var(--muted-foreground)]">
                  Endpoint
                </dt>
                <dd className="break-all">{endpoint}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export { ErrorState };
