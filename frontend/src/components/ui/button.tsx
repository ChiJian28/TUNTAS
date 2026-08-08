import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-[family-name:var(--font-sans)] no-underline transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--primary)] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-[var(--primary-hover)] hover:text-white active:bg-[var(--primary-active)] active:text-white",
        secondary:
          "border border-[var(--border-strong)] bg-[var(--surface)] font-medium text-[var(--foreground)] hover:bg-[var(--surface-emphasis)]",
        outline:
          "border border-[var(--border)] bg-[var(--surface-raised)] font-medium text-[var(--foreground)] hover:bg-[var(--surface)]",
        ghost:
          "font-medium text-[var(--foreground)] hover:bg-[var(--surface-emphasis)]",
        destructive:
          "bg-[var(--destructive)] font-semibold text-[var(--surface-raised)] hover:bg-[var(--destructive)]/90",
        link: "font-medium text-[var(--link)] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
