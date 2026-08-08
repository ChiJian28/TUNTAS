"use client";

import type { EventClickArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TrainingSessionView } from "@/lib/api/generated/openapi.types";

type CalendarBoardProps = {
  sessions: TrainingSessionView[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
};

export function CalendarBoard({
  sessions,
  selectedSessionId,
  onSelectSession,
}: CalendarBoardProps) {
  const events = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        start: s.starts_at,
        end: s.ends_at,
        extendedProps: {
          course_code: s.course_code,
          delivery_mode: s.delivery_mode,
          location: s.location,
          capacity: s.capacity,
        },
      })),
    [sessions],
  );

  function onEventClick(info: EventClickArg) {
    const id = info.event.id;
    onSelectSession(selectedSessionId === id ? null : id);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Q3 delivery calendar</CardTitle>
        <CardDescription>
          Asia/Kuala_Lumpur · month / week / list · read-only (no drag
          reschedule). Select a session to filter assignments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="tuntas-calendar rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-2">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,listWeek",
            }}
            timeZone="Asia/Kuala_Lumpur"
            events={events}
            editable={false}
            droppable={false}
            eventStartEditable={false}
            eventDurationEditable={false}
            eventClick={onEventClick}
            height="auto"
            eventContent={(arg) => {
              const ext = arg.event.extendedProps as {
                course_code?: string;
                delivery_mode?: string;
                location?: string;
                capacity?: number;
              };
              return (
                <div className="overflow-hidden px-1 text-[11px] leading-tight">
                  <div className="font-medium">{arg.event.title}</div>
                  <div className="opacity-80">
                    {ext.course_code} · {ext.delivery_mode ?? "?"}
                    {ext.location ? ` · ${ext.location}` : ""}
                    {ext.capacity != null ? ` · cap ${ext.capacity}` : ""}
                  </div>
                </div>
              );
            }}
            eventClassNames={(arg) =>
              arg.event.id === selectedSessionId
                ? ["tuntas-cal-selected"]
                : []
            }
          />
        </div>
        {selectedSessionId ? (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            Selected session{" "}
            <span className="font-mono">{selectedSessionId}</span> — click again
            to clear.
          </p>
        ) : null}
        <style>{`
          .tuntas-calendar .fc {
            font-family: var(--font-inter), var(--font-sans);
            --fc-border-color: var(--border);
            --fc-page-bg-color: transparent;
            --fc-neutral-bg-color: var(--surface);
            --fc-button-bg-color: var(--surface-raised);
            --fc-button-border-color: var(--border-strong);
            --fc-button-text-color: var(--foreground);
            --fc-button-hover-bg-color: var(--surface-emphasis);
            --fc-button-active-bg-color: var(--primary-soft);
            --fc-today-bg-color: var(--primary-soft);
          }
          .tuntas-calendar .fc-event {
            background: var(--evidence-soft);
            border-color: var(--evidence);
            color: var(--foreground);
            cursor: pointer;
          }
          .tuntas-calendar .tuntas-cal-selected {
            box-shadow: 0 0 0 2px var(--primary);
          }
        `}</style>
      </CardContent>
    </Card>
  );
}
