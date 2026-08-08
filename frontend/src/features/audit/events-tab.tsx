"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyIdButton } from "@/features/audit/copy-id";
import type { RunEvent } from "@/lib/api/generated/openapi.types";
import { formatKlShort } from "@/lib/format/time";

type Props = {
  events: RunEvent[];
};

export function EventsTab({ events }: Props) {
  const [eventType, setEventType] = useState<string>("all");
  const [actor, setActor] = useState<string>("all");
  const [query, setQuery] = useState("");

  const eventTypes = useMemo(
    () => Array.from(new Set(events.map((e) => e.event_type))).sort(),
    [events],
  );
  const actors = useMemo(
    () => Array.from(new Set(events.map((e) => e.actor_id))).sort(),
    [events],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (eventType !== "all" && e.event_type !== eventType) return false;
      if (actor !== "all" && e.actor_id !== actor) return false;
      if (!q) return true;
      return (
        e.id.toLowerCase().includes(q) ||
        e.event_type.toLowerCase().includes(q) ||
        e.actor_id.toLowerCase().includes(q) ||
        e.actor_role.toLowerCase().includes(q) ||
        JSON.stringify(e.payload).toLowerCase().includes(q)
      );
    });
  }, [events, eventType, actor, query]);

  if (!events.length) {
    return (
      <EmptyState
        title="No audit events"
        description="Append-only run events will appear here as the pipeline progresses."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] space-y-1">
          <Label className="text-[11px]">Event type</Label>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] space-y-1">
          <Label className="text-[11px]">Actor</Label>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actors</SelectItem>
              {actors.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label className="text-[11px]">Search</Label>
          <Input
            className="h-8 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by id, type, actor…"
          />
        </div>
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)]">
        Append-only audit events. This UI does not claim a cryptographically
        verified audit chain — RunEvent has no event-chain hash field.
      </p>

      <div className="mt-1 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[var(--surface)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
              <tr>
                <th className="border-b border-[var(--border)] px-4 py-3 font-medium">
                  Timestamp
                </th>
                <th className="border-b border-[var(--border)] px-4 py-3 font-medium">
                  Event type
                </th>
                <th className="border-b border-[var(--border)] px-4 py-3 font-medium">
                  Actor
                </th>
                <th className="border-b border-[var(--border)] px-4 py-3 font-medium">
                  Event ID
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]"
                  >
                    No events match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((event) => (
                  <tr
                    key={event.id}
                    className="transition-colors hover:bg-[var(--surface-emphasis)]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] tabular-nums text-[var(--muted-foreground)] font-[family-name:var(--font-mono)]">
                      {formatKlShort(event.created_at)}
                    </td>
                    <td className="px-4 py-2.5 align-middle">
                      <Badge
                        variant="muted"
                        className="border border-[var(--border-strong)] bg-transparent font-mono text-[11px]"
                      >
                        {event.event_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 align-middle">
                      <span className="font-mono text-[11px] text-[var(--foreground)]">
                        {event.actor_id}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[var(--muted-foreground)]">
                        {event.actor_role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-middle">
                      <CopyIdButton value={event.id} label="Event ID" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
