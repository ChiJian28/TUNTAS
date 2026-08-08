"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Bot,
  ShieldAlert,
  UserRound,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ParsedTurn, ScenarioTheme } from "@/features/simulation/turn-utils";
import { cn } from "@/lib/utils";

type Props = {
  turns: ParsedTurn[];
  typing: boolean;
  theme: ScenarioTheme;
  progressLabel: string;
  beat: number;
  totalHint: number;
};

function RoleAvatar({
  role,
  themeClass,
}: {
  role: "learner" | "system";
  themeClass: string;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)]",
        role === "learner"
          ? "bg-[var(--primary-soft)] text-[var(--primary)]"
          : themeClass,
      )}
      aria-hidden
    >
      {role === "learner" ? (
        <UserRound className="size-3.5" />
      ) : (
        <Bot className="size-3.5" />
      )}
    </span>
  );
}

export function NarrativeTimeline({
  turns,
  typing,
  theme,
  progressLabel,
  beat,
  totalHint,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, typing]);

  const fill = totalHint > 0 ? Math.min(1, beat / totalHint) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-[var(--foreground)]">
            Scene dialogue
          </h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {progressLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-emphasis)] sm:block"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
              style={{ width: `${Math.round(fill * 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-1" aria-label="Path so far">
            {Array.from({ length: Math.max(totalHint, beat, 1) })
              .slice(0, 8)
              .map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-1.5 rounded-full",
                    i < beat
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--border-strong)]",
                  )}
                />
              ))}
          </div>
          <Badge variant="muted" className="tabular-nums">
            {turns.length} msgs
          </Badge>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]">
        <div className="space-y-4 p-4">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <span
                className={cn(
                  "flex size-12 items-center justify-center rounded-full",
                  theme.avatarNpc,
                )}
              >
                <Bot className="size-5" aria-hidden />
              </span>
              <p className="text-sm text-[var(--muted-foreground)]">
                Start the session — the narrator will open the scene.
              </p>
            </div>
          ) : null}

          {turns.map((turn, i) => {
            const isLearner = turn.role === "learner";
            const prev = turns[i - 1];
            const isConsequence =
              !isLearner &&
              Boolean(turn.complication) &&
              prev?.role === "learner";

            return (
              <motion.div
                key={`${turn.index}-${turn.role}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28 }}
                className={cn(
                  "flex gap-2.5",
                  isLearner ? "flex-row-reverse" : "flex-row",
                )}
              >
                <RoleAvatar
                  role={isLearner ? "learner" : "system"}
                  themeClass={theme.avatarNpc}
                />
                <div
                  className={cn(
                    "max-w-[min(100%,28rem)] space-y-2",
                    isLearner ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-1.5",
                      isLearner && "justify-end",
                    )}
                  >
                    <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
                      {isLearner ? "You" : "Narrator"}
                    </span>
                    {turn.difficulty ? (
                      <Badge
                        variant={
                          turn.difficulty.toLowerCase() === "critical"
                            ? "destructive"
                            : "warning"
                        }
                        className="gap-1 text-[10px]"
                      >
                        {turn.difficulty.toLowerCase() === "critical" ? (
                          <ShieldAlert className="size-3" aria-hidden />
                        ) : (
                          <Zap className="size-3" aria-hidden />
                        )}
                        {turn.difficulty}
                      </Badge>
                    ) : null}
                    <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                      #{turn.index}
                    </span>
                  </div>

                  <article
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                      isLearner
                        ? "rounded-tr-md border border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--foreground)]"
                        : "rounded-tl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--body)]",
                    )}
                  >
                    {isLearner ? (
                      <div className="space-y-1.5">
                        {turn.action ? <p>{turn.action}</p> : null}
                        {turn.actions.length > 0 ? (
                          <ul className="space-y-1">
                            {turn.actions.map((a) => (
                              <li
                                key={a}
                                className="rounded-lg bg-[var(--surface-raised)]/70 px-2 py-1 text-[var(--body)]"
                              >
                                {a}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {turn.narrator ? (
                          <p className="italic text-[var(--muted-foreground)]">
                            {turn.narrator}
                          </p>
                        ) : null}
                        {turn.situation ? (
                          <p>
                            <span className="font-medium text-[var(--foreground)]">
                              Situation —{" "}
                            </span>
                            {turn.situation}
                          </p>
                        ) : null}
                        {turn.npcMessage ? <p>{turn.npcMessage}</p> : null}
                      </div>
                    )}
                  </article>

                  {turn.complication ? (
                    <div
                      className={cn(
                        "flex gap-2 rounded-xl border px-3 py-2 text-xs",
                        isConsequence
                          ? "border-[var(--destructive)]/35 bg-[var(--destructive-soft)] text-[var(--destructive)] ring-2 ring-[var(--destructive)]/20"
                          : "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning)]",
                      )}
                      role="status"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden
                      />
                      <div>
                        <p className="font-semibold tracking-wide">
                          {isConsequence
                            ? "Consequence of your last decision"
                            : "Complication"}
                        </p>
                        <p className="mt-0.5 leading-relaxed opacity-95">
                          {turn.complication}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}

          {typing ? (
            <div className="flex gap-2.5" aria-live="polite">
              <RoleAvatar role="system" themeClass={theme.avatarNpc} />
              <div className="rounded-2xl rounded-tl-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex gap-1">
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-[var(--muted-foreground)] [animation-delay:300ms]" />
                  </span>
                  Narrator is adapting the scene…
                </span>
              </div>
            </div>
          ) : null}
          <div ref={endRef} aria-hidden className="h-px" />
        </div>
      </ScrollArea>
    </div>
  );
}
