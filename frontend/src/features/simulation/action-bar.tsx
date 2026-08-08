"use client";

import { BadgeCheck, Check, Lock, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Props = {
  options: string[];
  selectedAction: string | null;
  onSelectAction: (action: string) => void;
  rationale: string;
  onRationaleChange: (v: string) => void;
  onSubmit: () => void;
  onFinalize: () => void;
  onAbandon: () => void;
  canFinalize: boolean;
  disabled: boolean;
  submitting: boolean;
  finalizing: boolean;
  abandoning: boolean;
  sessionActive: boolean;
  progressLabel?: string;
};

export function ActionBar({
  options,
  selectedAction,
  onSelectAction,
  rationale,
  onRationaleChange,
  onSubmit,
  onFinalize,
  onAbandon,
  canFinalize,
  disabled,
  submitting,
  finalizing,
  abandoning,
  sessionActive,
  progressLabel,
}: Props) {
  const finalizeUnlocked = sessionActive && canFinalize;
  const finalizeReady = finalizeUnlocked && !finalizing && !disabled;
  const finalizeLocked = !finalizeUnlocked;
  const canSubmit =
    !disabled &&
    !submitting &&
    (Boolean(rationale.trim()) || Boolean(selectedAction));

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Your move
          </p>
          {progressLabel ? (
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {progressLabel}
            </p>
          ) : null}
        </div>
        {submitting ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Analysing decision…
          </span>
        ) : null}
      </div>

      {options.length > 0 ? (
        <fieldset className="min-w-0 space-y-2.5" disabled={disabled || submitting}>
          <legend className="mb-1 text-sm font-medium text-[var(--foreground)]">
            Choose one decision
          </legend>
          <p className="text-xs text-[var(--muted-foreground)]">
            Options are mutually exclusive — select a single course of action.
          </p>
          <div
            className="flex flex-col gap-2.5"
            role="radiogroup"
            aria-label="Decision options"
          >
            {options.map((option, index) => {
              const selected = selectedAction === option;
              const optionId = `sim-action-${index}`;
              return (
                <label
                  key={option}
                  htmlFor={optionId}
                  className={cn(
                    "group relative flex cursor-pointer gap-3 rounded-2xl border px-4 py-3.5 transition-colors",
                    selected
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-[inset_3px_0_0_0_var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-emphasis)]/60",
                    (disabled || submitting) && "cursor-not-allowed opacity-55",
                  )}
                >
                  <input
                    id={optionId}
                    type="radio"
                    name="sim-action"
                    value={option}
                    checked={selected}
                    disabled={disabled || submitting}
                    onChange={() => onSelectAction(option)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-transparent group-hover:border-[var(--muted-foreground)]",
                    )}
                    aria-hidden
                  >
                    <Check className="size-3 stroke-[3]" />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-sm leading-relaxed",
                      selected
                        ? "font-medium text-[var(--foreground)]"
                        : "text-[var(--body)]",
                    )}
                  >
                    {option}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="sim-rationale">
          Free-text rationale
          {options.length > 0 ? (
            <span className="ml-1 font-normal text-[var(--muted-foreground)]">
              (optional note, or write your own action)
            </span>
          ) : null}
        </Label>
        <Textarea
          id="sim-rationale"
          rows={3}
          value={rationale}
          disabled={disabled || submitting}
          onChange={(e) => onRationaleChange(e.target.value)}
          placeholder="Describe what you would do and why…"
          className="resize-none"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          size="lg"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="min-w-[10rem] font-semibold shadow-sm sm:flex-1"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Analysing…
            </>
          ) : (
            <>
              <Send className="size-4" aria-hidden />
              Submit action
            </>
          )}
        </Button>
        <Button
          type="button"
          variant={finalizeUnlocked ? "default" : "outline"}
          disabled={!finalizeReady}
          title={
            finalizeLocked
              ? sessionActive
                ? "Finalize unlocks when the narrator ends the scene or after enough learner turns."
                : "Start and complete the scene before finalizing"
              : "Lock in deterministic score and proof"
          }
          onClick={onFinalize}
          className={cn(
            "min-w-[9.5rem] font-semibold",
            finalizeLocked &&
              "cursor-not-allowed border-dashed border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted-foreground)] shadow-none disabled:opacity-100",
            finalizeUnlocked &&
              "bg-[var(--primary)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] ring-[3px] ring-[var(--focus-ring)] disabled:opacity-80",
            finalizeReady &&
              "hover:bg-[var(--primary-hover)] hover:ring-[var(--primary)]/30",
          )}
        >
          {finalizing ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finalizing…
            </>
          ) : finalizeUnlocked ? (
            <>
              <BadgeCheck aria-hidden />
              Finalize proof
            </>
          ) : (
            <>
              <Lock aria-hidden />
              Finalize proof
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!sessionActive || abandoning || disabled || submitting}
          onClick={onAbandon}
          className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
        >
          {abandoning ? "Abandoning…" : "Abandon"}
        </Button>
      </div>
      {finalizeLocked ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          {sessionActive
            ? "Locked until the narrator ends the scene or enough learner turns complete — then this becomes the primary orange action."
            : "Start a session and play through turns; Finalize unlocks when the scene can be scored."}
        </p>
      ) : finalizeReady ? (
        <p className="text-xs font-medium text-[var(--primary)]">
          Ready — finalize to lock deterministic score and evidence hash.
        </p>
      ) : null}
    </div>
  );
}
