"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  downloadAndVerify,
  triggerBrowserDownload,
} from "@/lib/api/downloads";
import { normalizeApiError } from "@/lib/api/errors";
import type { ArtifactView } from "@/lib/api/generated/openapi.types";
import { formatKl } from "@/lib/format/time";

type ArtifactsShelfProps = {
  artifacts: ArtifactView[];
};

type VerifyState = {
  computedSha256: string;
  matches: boolean;
};

export function ArtifactsShelf({ artifacts }: ArtifactsShelfProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifyById, setVerifyById] = useState<Record<string, VerifyState>>(
    {},
  );

  async function onDownload(artifact: ArtifactView) {
    setBusyId(artifact.id);
    try {
      const result = await downloadAndVerify(artifact);
      setVerifyById((prev) => ({
        ...prev,
        [artifact.id]: {
          computedSha256: result.computedSha256,
          matches: result.matches,
        },
      }));
      triggerBrowserDownload(result.blob, artifact.filename);
      toast.success(
        result.matches
          ? "SHA-256 matched manifest"
          : "Downloaded — integrity mismatch",
      );
    } catch (error) {
      toast.error(normalizeApiError(error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Artifact integrity shelf</CardTitle>
        <CardDescription>
          Authenticated blob download. Browser SHA-256 compared to API sha256.
          HMAC shows “Signature recorded” only — never “verified”.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {artifacts.length === 0 ? (
          <EmptyState
            title="No artifacts"
            description="API returned an empty artifacts list."
          />
        ) : (
          <ul className="space-y-3">
            {artifacts.map((a) => {
              const v = verifyById[a.id];
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-[var(--border)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{a.filename}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="muted">{a.artifact_type}</Badge>
                        <Badge variant="muted">{a.content_type}</Badge>
                        <Badge variant="muted">
                          {a.byte_size.toLocaleString()} bytes
                        </Badge>
                      </div>
                      <p className="mt-2 font-mono text-xs text-[var(--muted-foreground)]">
                        sha256: {a.sha256}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        HMAC signature recorded by backend
                        {a.hmac_signature
                          ? ` · ${a.hmac_signature.slice(0, 16)}…`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {formatKl(a.created_at)}
                      </p>
                      {v ? (
                        <p
                          className={
                            v.matches
                              ? "mt-2 text-xs text-[var(--success)]"
                              : "mt-2 text-xs text-[var(--destructive)]"
                          }
                        >
                          {v.matches
                            ? "SHA-256 matched manifest"
                            : "Integrity mismatch"}{" "}
                          · computed{" "}
                          <span className="font-mono">
                            {v.computedSha256.slice(0, 16)}…
                          </span>
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === a.id}
                      onClick={() => void onDownload(a)}
                    >
                      {busyId === a.id ? "Downloading…" : "Download & check"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
