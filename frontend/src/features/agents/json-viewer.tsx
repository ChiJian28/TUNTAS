"use client";

import { JsonView, allExpanded, darkStyles, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

import { cn } from "@/lib/utils";

type JsonViewerProps = {
  data: unknown;
  className?: string;
  /** Use code-panel dark surface for raw evidence; default light editorial. */
  variant?: "light" | "code";
  initiallyExpanded?: boolean;
};

export function JsonViewer({
  data,
  className,
  variant = "light",
  initiallyExpanded = false,
}: JsonViewerProps) {
  const styles = variant === "code" ? darkStyles : defaultStyles;

  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border border-[var(--border)] text-xs font-[family-name:var(--font-mono)]",
        variant === "code"
          ? "bg-[var(--code-background)] text-[var(--code-foreground)]"
          : "bg-[var(--surface)] text-[var(--foreground)]",
        className,
      )}
    >
      <JsonView
        data={data as object}
        shouldExpandNode={initiallyExpanded ? allExpanded : undefined}
        style={styles}
      />
    </div>
  );
}
