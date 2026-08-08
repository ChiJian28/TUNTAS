"use client";

import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { AGENT_PIPELINE } from "@/lib/constants/agents";
import {
  formatKlClock,
  formatKlMinute,
  klMinuteKey,
} from "@/lib/format/time";
import {
  challengerPayloadSchema,
  parseHandoffEnvelope,
  safeParsePayload,
} from "@/lib/schemas/payloads";
import type {
  AgentHandoffView,
  TimelineResponse,
} from "@/lib/api/generated/openapi.types";
import { cn } from "@/lib/utils";

type TimelineItem = TimelineResponse["items"][number];
type HandoffItem = Extract<TimelineItem, { kind: "handoff" }>;
type EventItem = Extract<TimelineItem, { kind: "event" }>;

type MinuteGroup = {
  key: string;
  label: string;
  items: TimelineItem[];
};

function groupByMinute(items: TimelineItem[]): MinuteGroup[] {
  const order: string[] = [];
  const map = new Map<string, MinuteGroup>();
  for (const item of items) {
    const key = klMinuteKey(item.at);
    let group = map.get(key);
    if (!group) {
      group = { key, label: formatKlMinute(item.at), items: [] };
      map.set(key, group);
      order.push(key);
    }
    group.items.push(item);
  }
  return order.map((k) => map.get(k)!);
}

function agentBadgeLabel(agentName: string): string {
  const lower = agentName.toLowerCase();
  for (const node of AGENT_PIPELINE) {
    if (!("agentNames" in node) || !node.agentNames) continue;
    const hit = node.agentNames.some((n) => {
      const nn = n.toLowerCase();
      return lower === nn || lower.includes(nn) || nn.includes(lower);
    });
    if (hit) return node.label.toUpperCase();
  }
  const short = agentName.split(/[./]/).pop() ?? agentName;
  return short.replace(/_/g, " ").toUpperCase();
}

function detectVeto(
  item: HandoffItem,
  handoff: AgentHandoffView | undefined,
): boolean {
  if (/veto/i.test(item.summary)) return true;
  if (!handoff) return false;
  const env = parseHandoffEnvelope(handoff.output_json);
  if (!env.ok) return false;
  const payload = safeParsePayload(challengerPayloadSchema, env.data.payload);
  if (!payload.ok) return false;
  const flags = [
    ...(payload.data.vetoes ?? []),
    ...(payload.data.option_flags ?? []),
    ...(payload.data.evidence_insufficient ?? []),
  ];
  return flags.some(
    (f) =>
      f.veto === true ||
      String(f.severity ?? "").toLowerCase() === "critical",
  );
}

export function PersistedTimeline({
  items,
  handoffById,
  onOpenHandoff,
}: {
  items: TimelineItem[];
  handoffById: Map<string, AgentHandoffView>;
  onOpenHandoff: (handoff: AgentHandoffView) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const groups = useMemo(() => groupByMinute(items), [items]);

  return (
    <div className="relative max-h-[480px] overflow-y-auto pr-1">
      {/* Continuous left axis — centered on the 16px marker column */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-[7px] top-2 w-px bg-[var(--border)]"
      />

      <AnimatePresence initial={false}>
        {groups.map((group) => (
          <motion.section
            key={group.key}
            layout={!prefersReducedMotion}
            initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative mb-5 last:mb-1"
          >
            <div className="relative mb-2 flex items-center gap-3">
              <span
                aria-hidden
                className="relative z-10 size-4 shrink-0 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)]"
              />
              <h4 className="font-display text-lg tabular-nums tracking-tight text-[var(--foreground)]">
                {group.label}
              </h4>
            </div>

            <ul className="space-y-2">
              {group.items.map((item) =>
                item.kind === "event" ? (
                  <EventRow
                    key={item.id}
                    item={item}
                    reduced={Boolean(prefersReducedMotion)}
                  />
                ) : (
                  <HandoffRow
                    key={item.id}
                    item={item}
                    reduced={Boolean(prefersReducedMotion)}
                    isVeto={detectVeto(item, handoffById.get(item.id))}
                    onOpen={() => {
                      const h = handoffById.get(item.id);
                      if (h) onOpenHandoff(h);
                    }}
                  />
                ),
              )}
            </ul>
          </motion.section>
        ))}
      </AnimatePresence>
    </div>
  );
}

function EventRow({
  item,
  reduced,
}: {
  item: EventItem;
  reduced: boolean;
}) {
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="relative flex gap-3"
    >
      <span className="relative z-10 flex w-4 shrink-0 justify-center pt-1.5">
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-[var(--border-strong)]"
        />
      </span>
      <p className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        <span className="tabular-nums">{formatKlClock(item.at)}</span>
        <span className="mx-1.5">·</span>
        <span className="break-all">{item.event_type}</span>
      </p>
    </motion.li>
  );
}

function HandoffRow({
  item,
  isVeto,
  reduced,
  onOpen,
}: {
  item: HandoffItem;
  isVeto: boolean;
  reduced: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="relative flex gap-3"
    >
      <span className="relative z-10 flex w-4 shrink-0 justify-center pt-3">
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full ring-2 ring-[var(--surface-raised)]",
            isVeto ? "bg-[#ff0009]" : "bg-[var(--primary)]",
          )}
        />
      </span>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-left shadow-sm transition-colors hover:bg-[var(--surface)]",
          isVeto && "border-l-[3px] border-l-[#ff0009]",
        )}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge variant={isVeto ? "destructive" : "soft-primary"}>
            {agentBadgeLabel(item.agent_name)}
          </Badge>
          {isVeto ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#ff0009]">
              Veto
            </span>
          ) : item.requires_review ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--warning)]">
              Review
            </span>
          ) : null}
          <span className="font-mono text-[10px] tabular-nums text-[var(--muted-foreground)]">
            {formatKlClock(item.at)}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-[var(--body)] font-[family-name:var(--font-sans)]">
          {item.summary}
        </p>
      </button>
    </motion.li>
  );
}
