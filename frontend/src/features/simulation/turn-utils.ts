import {
  adaptiveTurnSchema,
  safeParsePayload,
  scenarioRubricItemSchema,
} from "@/lib/schemas/payloads";

export type ParsedTurn = {
  index: number;
  role: "system" | "learner" | "unknown";
  difficulty?: string;
  narrator?: string;
  npcMessage?: string;
  situation?: string;
  complication?: string;
  action?: string;
  actions: string[];
  choicesHint: string[];
  observedSignals: string[];
  continue?: boolean;
  raw: Record<string, unknown>;
};

export function parseTurn(raw: unknown, fallbackIndex: number): ParsedTurn {
  const parsed = safeParsePayload(adaptiveTurnSchema, raw);
  const data = parsed.ok
    ? parsed.data
    : (raw as Record<string, unknown> | null) ?? {};

  const roleRaw = String(data.role ?? data.speaker ?? "").toLowerCase();
  const role: ParsedTurn["role"] =
    roleRaw === "learner" || roleRaw === "user"
      ? "learner"
      : roleRaw === "system" || roleRaw === "npc" || roleRaw === "narrator"
        ? "system"
        : "unknown";

  const textBlob = [
    data.text,
    data.narrative,
    data.content,
    data.action,
    data.narrator,
    data.npc_message,
    data.situation,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ");

  return {
    index:
      typeof data.turn === "number"
        ? data.turn
        : typeof data.turn_index === "number"
          ? data.turn_index
          : fallbackIndex,
    role,
    difficulty: typeof data.difficulty === "string" ? data.difficulty : undefined,
    narrator: typeof data.narrator === "string" ? data.narrator : undefined,
    npcMessage:
      typeof data.npc_message === "string"
        ? data.npc_message
        : textBlob && role === "system"
          ? textBlob
          : undefined,
    situation: typeof data.situation === "string" ? data.situation : undefined,
    complication:
      typeof data.complication === "string" ? data.complication : undefined,
    action:
      typeof data.action === "string"
        ? data.action
        : role === "learner" && textBlob
          ? textBlob
          : undefined,
    actions: Array.isArray(data.actions)
      ? data.actions.filter((a): a is string => typeof a === "string")
      : [],
    choicesHint: Array.isArray(data.choices_hint)
      ? data.choices_hint.filter((a): a is string => typeof a === "string")
      : [],
    observedSignals: Array.isArray(data.observed_signals)
      ? data.observed_signals.filter((a): a is string => typeof a === "string")
      : [],
    continue: typeof data.continue === "boolean" ? data.continue : undefined,
    raw:
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : { value: raw },
  };
}

export function parseTurns(turns: Record<string, unknown>[] | undefined): ParsedTurn[] {
  if (!turns?.length) return [];
  return turns.map((t, i) => parseTurn(t, i));
}

/** Derive can_finalize from session turns when resuming (GET session has no can_finalize). */
export function deriveCanFinalize(
  status: string | undefined,
  turns: ParsedTurn[],
): boolean {
  if (status !== "in_progress") return false;
  const learnerCount = turns.filter((t) => t.role === "learner").length;
  const lastSystem = [...turns].reverse().find((t) => t.role === "system");
  if (lastSystem?.continue === false) return true;
  return learnerCount >= 3;
}

/** Collect required_signals only — never expose level3_behavior answers. */
export function extractSignalCatalog(
  rubric: Record<string, unknown>[] | undefined,
): string[] {
  if (!rubric?.length) return [];
  const out: string[] = [];
  for (const item of rubric) {
    const parsed = safeParsePayload(scenarioRubricItemSchema, item);
    if (!parsed.ok) continue;
    for (const s of parsed.data.required_signals ?? []) {
      const n = s.trim().toLowerCase();
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** Observed signals = keywords that appear in learner transcript (not full rubric). */
export function deriveObservedSignals(
  turns: ParsedTurn[],
  signalCatalog: string[],
): string[] {
  const fromApi = new Set<string>();
  for (const t of turns) {
    for (const s of t.observedSignals) fromApi.add(s.toLowerCase());
  }

  const blob = turns
    .filter((t) => t.role === "learner")
    .map((t) =>
      [t.action, ...t.actions].filter(Boolean).join(" ").toLowerCase(),
    )
    .join(" ");

  const matched = signalCatalog.filter((s) => blob.includes(s.toLowerCase()));
  return Array.from(new Set([...fromApi, ...matched]));
}

export function latestChoices(turns: ParsedTurn[]): string[] {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].choicesHint.length) return turns[i].choicesHint;
  }
  return [];
}

export function difficultyTintClass(difficulty: string | undefined): string {
  const d = (difficulty ?? "standard").toLowerCase();
  if (d === "critical" || d === "high") {
    return "bg-[var(--destructive-soft)]/60";
  }
  if (d === "elevated" || d === "medium") {
    return "bg-[var(--warning-soft)]/70";
  }
  return "bg-[var(--background)]";
}

export type PressureLevel = "calm" | "elevated" | "critical";

export function pressureFromDifficulty(
  difficulty: string | undefined,
): PressureLevel {
  const d = (difficulty ?? "standard").toLowerCase();
  if (d === "critical" || d === "high") return "critical";
  if (d === "elevated" || d === "medium") return "elevated";
  return "calm";
}

export function countLearnerTurns(turns: ParsedTurn[]): number {
  return turns.filter((t) => t.role === "learner").length;
}

/** Soft progress: learner decisions so far vs adaptive scene depth. */
export function sceneProgress(turns: ParsedTurn[], canFinalize: boolean): {
  beat: number;
  totalHint: number;
  label: string;
} {
  const beat = countLearnerTurns(turns);
  const totalHint = canFinalize ? Math.max(beat, 1) : Math.max(beat + 2, 5);
  return {
    beat,
    totalHint,
    label: canFinalize
      ? `Scene ready · ${beat} decision${beat === 1 ? "" : "s"}`
      : `Decision ${beat} · ~${totalHint} expected`,
  };
}

export type ScenarioTheme = {
  key: "fraud" | "aml" | "pdpa" | "cyber" | "default";
  label: string;
  accentBar: string;
  avatarNpc: string;
  chip: string;
};

export function scenarioTheme(code: string | undefined | null): ScenarioTheme {
  const c = (code ?? "").toUpperCase();
  if (c.includes("FRAUD") || c.includes("MULE")) {
    return {
      key: "fraud",
      label: "Fraud desk",
      accentBar: "from-[var(--destructive)]/80 via-[var(--primary)]/50 to-transparent",
      avatarNpc: "bg-[var(--destructive-soft)] text-[var(--destructive)]",
      chip: "border-[var(--destructive)]/25 bg-[var(--destructive-soft)] text-[var(--destructive)]",
    };
  }
  if (c.includes("AML") || c.includes("ESC")) {
    return {
      key: "aml",
      label: "AML escalation",
      accentBar: "from-[var(--warning)]/80 via-[var(--primary)]/40 to-transparent",
      avatarNpc: "bg-[var(--warning-soft)] text-[var(--warning)]",
      chip: "border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]",
    };
  }
  if (c.includes("PDPA") || c.includes("VENDOR")) {
    return {
      key: "pdpa",
      label: "PDPA / vendor",
      accentBar: "from-[var(--evidence)]/80 via-[var(--primary)]/35 to-transparent",
      avatarNpc: "bg-[var(--evidence-soft)] text-[var(--evidence)]",
      chip: "border-[var(--evidence)]/25 bg-[var(--evidence-soft)] text-[var(--evidence)]",
    };
  }
  if (c.includes("CS") || c.includes("SE") || c.includes("CYBER")) {
    return {
      key: "cyber",
      label: "Cyber / SE",
      accentBar: "from-[var(--primary)]/70 via-[var(--evidence)]/40 to-transparent",
      avatarNpc: "bg-[var(--primary-soft)] text-[var(--primary)]",
      chip: "border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--primary)]",
    };
  }
  return {
    key: "default",
    label: "Simulation",
    accentBar: "from-[var(--primary)]/50 to-transparent",
    avatarNpc: "bg-[var(--surface-emphasis)] text-[var(--foreground)]",
    chip: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)]",
  };
}

