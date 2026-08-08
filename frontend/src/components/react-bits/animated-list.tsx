"use client";

/**
 * Adapted from React Bits AnimatedList (TS + Tailwind).
 * https://www.reactbits.dev/components/animated-list
 *
 * TUNTAS rules (FRONTEND.md §5.2 / §5.3 / Scene 2):
 * - Item keys MUST be stable backend IDs (caller responsibility)
 * - Stagger only for real arrivals; respect prefers-reduced-motion
 * - No decorative infinite pulse
 * - Generic renderItem API (not demo string list)
 */

import {
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export interface AnimatedListProps<T extends { id: string }> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  itemClassName?: string;
  /** Stagger between item entrances (seconds). Default 0.04; 0 disables. */
  stagger?: number;
  /** Max stagger index so long lists don't delay forever. */
  staggerCap?: number;
  /** Show scroll fade gradients. Uses surface-raised so it matches cards. */
  showGradients?: boolean;
  /** Fade color for gradients. Defaults to surface-raised (card interior). */
  gradientFrom?: string;
  /** Enable up/down keyboard focus within the list. */
  enableArrowNavigation?: boolean;
  onItemSelect?: (item: T, index: number) => void;
  maxHeight?: string | number;
}

function AnimatedList<T extends { id: string }>({
  items,
  renderItem,
  className,
  itemClassName,
  stagger = 0.04,
  staggerCap = 12,
  showGradients = false,
  gradientFrom = "var(--surface-raised)",
  enableArrowNavigation = false,
  onItemSelect,
  maxHeight,
}: AnimatedListProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [topGradientOpacity, setTopGradientOpacity] = useState(0);
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(1);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    if (!showGradients) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    setTopGradientOpacity(Math.min(scrollTop / 50, 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    setBottomGradientOpacity(
      scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1),
    );
  }, [showGradients]);

  useEffect(() => {
    if (!enableArrowNavigation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        onItemSelect?.(items[selectedIndex], selectedIndex);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableArrowNavigation, items, onItemSelect, selectedIndex]);

  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const reduced = Boolean(prefersReducedMotion);

  return (
    <div className={cn("relative", className)}>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className={cn(
          "flex flex-col overflow-y-auto",
          maxHeight != null && "pr-1",
        )}
        style={
          maxHeight != null
            ? {
                maxHeight:
                  typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
              }
            : undefined
        }
      >
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const delay = reduced
              ? 0
              : Math.min(index, staggerCap) * stagger;
            return (
              <motion.div
                key={item.id}
                data-index={index}
                layout={!reduced}
                initial={
                  reduced ? false : { opacity: 0, y: 10, scale: 0.98 }
                }
                animate={
                  reduced
                    ? undefined
                    : { opacity: 1, y: 0, scale: 1 }
                }
                exit={
                  reduced
                    ? undefined
                    : { opacity: 0, y: -6, scale: 0.98 }
                }
                transition={{
                  duration: 0.22,
                  ease: "easeOut",
                  delay,
                }}
                onClick={() => {
                  setSelectedIndex(index);
                  onItemSelect?.(item, index);
                }}
                className={cn(
                  "overflow-hidden",
                  selectedIndex === index &&
                    enableArrowNavigation &&
                    "rounded-xl ring-2 ring-[var(--focus-ring)]",
                  itemClassName,
                )}
              >
                {renderItem(item, index)}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {showGradients ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-10"
            style={{
              opacity: topGradientOpacity,
              background: `linear-gradient(to bottom, ${gradientFrom}, transparent)`,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            style={{
              opacity: bottomGradientOpacity,
              background: `linear-gradient(to top, ${gradientFrom}, transparent)`,
            }}
          />
        </>
      ) : null}
    </div>
  );
}

export { AnimatedList };
export default AnimatedList;
