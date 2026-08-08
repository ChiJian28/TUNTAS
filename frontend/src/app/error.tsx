"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[TUNTAS error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-[var(--background)] p-6">
      <div
        role="alert"
        className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--destructive)]/25 bg-[var(--surface-raised)] p-8 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 size-6 shrink-0 text-[var(--destructive)]"
            aria-hidden
          />
          <div className="space-y-2">
            <h1 className="font-display text-2xl text-[var(--foreground)]">
              Something went wrong
            </h1>
            <p className="text-sm text-[var(--body)]">
              The page hit an unexpected error. You can try again, or return to
              the run center. No mock fallback is loaded.
            </p>
            {error.message ? (
              <p className="rounded-lg bg-[var(--destructive-soft)] px-3 py-2 font-mono text-xs text-[var(--destructive)]">
                {error.message}
              </p>
            ) : null}
            {error.digest ? (
              <p className="font-mono text-[10px] text-[var(--muted-foreground)]">
                digest: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/runs">Back to runs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
