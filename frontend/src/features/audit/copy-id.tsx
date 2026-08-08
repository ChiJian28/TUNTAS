"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/format/copy";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  label?: string;
  className?: string;
  /** When false, render icon-only (hash shown elsewhere). Default true. */
  showValue?: boolean;
  /** Truncate the inline value. Ignored when showValue is false. Default true. */
  truncate?: boolean;
};

export function CopyIdButton({
  value,
  label,
  className,
  showValue = true,
  truncate = true,
}: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 gap-1 px-2 font-mono text-xs",
        showValue ? "max-w-full" : "px-1.5",
        className,
      )}
      title={label ? `Copy ${label}` : value}
      aria-label={label ? `Copy ${label}` : "Copy value"}
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) {
          setCopied(true);
          toast.success(label ? `${label} copied` : "Copied");
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast.error("Copy failed");
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden />
      ) : (
        <Copy className="size-3.5 shrink-0" aria-hidden />
      )}
      {showValue ? (
        <span
          className={cn(
            "min-w-0",
            truncate ? "truncate" : "whitespace-normal break-all text-left",
          )}
        >
          {value}
        </span>
      ) : null}
    </Button>
  );
}
