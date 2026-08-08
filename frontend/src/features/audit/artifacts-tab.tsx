"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyIdButton } from "@/features/audit/copy-id";
import {
  downloadAndVerify,
  triggerBrowserDownload,
} from "@/lib/api/downloads";
import type { ArtifactView } from "@/lib/api/generated/openapi.types";
import { formatKlShort } from "@/lib/format/time";
import { TuntasApiError } from "@/lib/api/errors";

type Props = {
  artifacts: ArtifactView[];
};

type VerifyState = {
  status: "idle" | "checking" | "match" | "mismatch" | "error";
  computed?: string;
  message?: string;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArtifactsTab({ artifacts }: Props) {
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});

  if (!artifacts.length) {
    return (
      <EmptyState
        title="No artifacts"
        description="Board packs and matrices appear after approval / outbox commit."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted-foreground)]">
        Browser SHA-256 compared to ArtifactView.sha256. HMAC is shown as
        “signature recorded by backend” — this UI does not verify HMAC.
      </p>
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-raised)]">
        {artifacts.map((a) => {
          const state = verify[a.id] ?? { status: "idle" as const };
          return (
            <li
              key={a.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold text-[var(--foreground)]">
                  {a.filename}
                </p>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                  {a.artifact_type} · {formatBytes(a.byte_size)} ·{" "}
                  {formatKlShort(a.created_at)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyIdButton value={a.id} label="Artifact ID" />
                  <CopyIdButton value={a.sha256} label="SHA-256" />
                </div>
                <p className="font-mono text-[10px] text-[var(--muted-foreground)]">
                  HMAC recorded:{" "}
                  {a.hmac_signature
                    ? `${a.hmac_signature.slice(0, 16)}…`
                    : "(empty)"}
                </p>
                {state.status === "match" ? (
                  <Badge variant="success">SHA-256 matched manifest</Badge>
                ) : null}
                {state.status === "mismatch" ? (
                  <Badge variant="destructive">Integrity mismatch</Badge>
                ) : null}
                {state.status === "error" ? (
                  <Badge variant="warning">
                    {state.message ?? "Verify failed"}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[var(--border-strong)]"
                  disabled={state.status === "checking"}
                  onClick={async () => {
                    setVerify((s) => ({
                      ...s,
                      [a.id]: { status: "checking" },
                    }));
                    try {
                      const result = await downloadAndVerify(a);
                      triggerBrowserDownload(result.blob, a.filename);
                      setVerify((s) => ({
                        ...s,
                        [a.id]: {
                          status: result.matches ? "match" : "mismatch",
                          computed: result.computedSha256,
                        },
                      }));
                      toast.success(
                        result.matches
                          ? "Downloaded — SHA-256 matched"
                          : "Downloaded — integrity mismatch",
                      );
                    } catch (err) {
                      const message =
                        err instanceof TuntasApiError
                          ? err.message
                          : "Download failed";
                      setVerify((s) => ({
                        ...s,
                        [a.id]: { status: "error", message },
                      }));
                      toast.error(message);
                    }
                  }}
                >
                  {state.status === "checking"
                    ? "Verifying…"
                    : "Download & verify"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
