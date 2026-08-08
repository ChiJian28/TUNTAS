"use client";

/**
 * Adapted from React Bits CountUp (TS + Tailwind).
 * https://www.reactbits.dev/text-animations/count-up
 *
 * TUNTAS rules (FRONTEND.md §5.2 / §5.3):
 * - Animate only when the numeric value actually changes from props
 * - Prefer ≤300ms for dashboard metrics
 * - Honour prefers-reduced-motion
 * - First paint shows final value (no decorative entrance count from 0)
 */

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface CountUpProps extends React.HTMLAttributes<HTMLSpanElement> {
  value?: number;
  /** React Bits alias for `value`. */
  to?: number;
  decimals?: number;
  /** Seconds. Default 0.28 (< 300ms UI budget). */
  duration?: number;
  delay?: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
  locale?: string;
}

function CountUp({
  value,
  to,
  decimals = 0,
  duration = 0.28,
  delay = 0,
  prefix = "",
  suffix = "",
  separator = ",",
  locale = "en-MY",
  className,
  ...props
}: CountUpProps) {
  const target = value ?? to;
  const prefersReducedMotion = useReducedMotion();
  const previousRef = useRef<number | null>(null);
  const [display, setDisplay] = useState(() =>
    target == null || Number.isNaN(target) ? 0 : target,
  );

  useEffect(() => {
    if (target == null || Number.isNaN(target)) return;

    const prev = previousRef.current;
    if (prev === target) return;

    // First mount: snap to value — no fake count-from-zero theatre.
    if (prev === null || prefersReducedMotion) {
      setDisplay(target);
      previousRef.current = target;
      return;
    }

    let stopped = false;
    let controls: { stop: () => void } | null = null;
    const timeout = window.setTimeout(() => {
      controls = animate(prev, target, {
        duration,
        ease: "easeOut",
        onUpdate: (latest) => {
          if (!stopped) setDisplay(latest);
        },
      });
    }, Math.max(0, delay) * 1000);

    previousRef.current = target;

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      controls?.stop();
    };
  }, [target, duration, delay, prefersReducedMotion]);

  if (target == null || Number.isNaN(target)) {
    return (
      <span
        className={cn("tabular-nums font-[family-name:var(--font-sans)]", className)}
        {...props}
      >
        {prefix}Unknown{suffix}
      </span>
    );
  }

  const formatted = new Intl.NumberFormat(locale, {
    useGrouping: Boolean(separator),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(display)
    .replace(/,/g, separator || ",");

  return (
    <span
      className={cn("tabular-nums font-[family-name:var(--font-sans)]", className)}
      {...props}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

export { CountUp };
export default CountUp;
