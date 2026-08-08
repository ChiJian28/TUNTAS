import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium font-[family-name:var(--font-sans)] transition-colors focus:outline-none focus:ring-[3px] focus:ring-[var(--focus-ring)]",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--foreground)] text-[var(--surface-raised)]",
        success:
          "border-transparent bg-[var(--success-soft)] text-[var(--success)]",
        warning:
          "border-transparent bg-[var(--warning-soft)] text-[var(--warning)]",
        evidence:
          "border-transparent bg-[var(--evidence-soft)] text-[var(--evidence)]",
        destructive:
          "border-transparent bg-[var(--destructive-soft)] text-[var(--destructive)]",
        muted:
          "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]",
        "soft-primary":
          "border-transparent bg-[var(--primary-soft)] text-[var(--primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
