"use client";

import { useState, type ReactNode } from "react";
import {
  Calendar,
  DownloadCloud,
  FileIcon,
  FileJson,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react";
import { toast } from "sonner";

import type { ArtifactView } from "@/lib/api/generated/openapi.types";
import {
  downloadAndVerify,
  triggerBrowserDownload,
} from "@/lib/api/downloads";
import { formatKlShort } from "@/lib/format/time";
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactExt(a: ArtifactView): string {
  const fromType = (a.artifact_type ?? "").toLowerCase().trim();
  if (fromType) return fromType.replace(/^\./, "");
  const name = a.filename ?? "";
  const dot = name.lastIndexOf(".");
  if (dot >= 0) return name.slice(dot + 1).toLowerCase();
  return "";
}

function getFileIcon(type: string): ReactNode {
  switch (type.toLowerCase()) {
    case "docx":
    case "doc":
      return <FileText className="size-5 text-blue-600" aria-hidden />;
    case "xlsx":
    case "xls":
    case "csv":
      return <FileSpreadsheet className="size-5 text-green-600" aria-hidden />;
    case "pptx":
    case "ppt":
      return <Presentation className="size-5 text-orange-500" aria-hidden />;
    case "json":
      return <FileJson className="size-5 text-yellow-600" aria-hidden />;
    case "ics":
      return <Calendar className="size-5 text-purple-500" aria-hidden />;
    case "pdf":
      return <FileText className="size-5 text-red-600" aria-hidden />;
    default:
      return (
        <FileIcon
          className="size-5 text-[var(--muted-foreground)]"
          aria-hidden
        />
      );
  }
}

export function ArtifactShelf({ artifacts }: { artifacts: ArtifactView[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<
    Record<string, { matches: boolean; computed: string }>
  >({});

  async function onDownload(a: ArtifactView) {
    setBusyId(a.id);
    try {
      const { blob, computedSha256, matches } = await downloadAndVerify(a);
      setResults((prev) => ({
        ...prev,
        [a.id]: { matches, computed: computedSha256 },
      }));
      triggerBrowserDownload(blob, a.filename);
      toast.message(
        matches
          ? "Download complete — browser SHA-256 matches API sha256"
          : "Download complete — SHA-256 mismatch vs API sha256",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!artifacts.length) {
    return (
      <EmptyState
        title="No artifacts yet"
        description="Awaiting management approval; no schedule or pack has been committed."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">
          Artifact integrity shelf
        </CardTitle>
        <CardDescription>
          Downloads use authenticated blob requests. Browser computes SHA-256 and
          compares to API `sha256`. HMAC presence is shown as “Signature
          recorded” only — not verified in the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {artifacts.map((a) => {
          const result = results[a.id];
          const ext = artifactExt(a);
          return (
            <div
              key={a.id}
              className="group rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm transition-all hover:border-[var(--border-strong)] hover:shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                    {getFileIcon(ext)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--foreground)] font-[family-name:var(--font-sans)]">
                      {a.filename}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                      {ext || "file"} · {formatBytes(a.byte_size)} ·{" "}
                      {formatKlShort(a.created_at)}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-[var(--border-strong)] font-medium text-[var(--foreground)] hover:bg-[var(--surface-emphasis)] hover:text-[var(--foreground)]"
                  disabled={busyId === a.id}
                  onClick={() => void onDownload(a)}
                >
                  <DownloadCloud className="size-4" aria-hidden />
                  {busyId === a.id ? "Verifying…" : "Download & Verify"}
                </Button>
              </div>

              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                  <dt className="text-right font-medium text-[var(--body)]">
                    SHA-256
                  </dt>
                  <dd className="truncate text-[var(--foreground)]" title={a.sha256}>
                    {a.sha256}
                  </dd>

                  <dt className="text-right font-medium text-[var(--body)]">
                    HMAC
                  </dt>
                  <dd>
                    Signature recorded
                    {a.hmac_signature ? "" : " (empty)"}
                  </dd>

                  {result ? (
                    <>
                      <div className="col-span-2 my-1 border-t border-dashed border-[var(--border-strong)]" />
                      <dt className="text-right font-medium text-[var(--body)]">
                        Computed
                      </dt>
                      <dd className="flex min-w-0 items-center gap-2 text-[var(--foreground)]">
                        <span className="truncate" title={result.computed}>
                          {result.computed}
                        </span>
                        <Badge
                          variant={result.matches ? "success" : "destructive"}
                          className="shrink-0 px-1.5 py-0"
                        >
                          {result.matches ? "MATCH" : "MISMATCH"}
                        </Badge>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
