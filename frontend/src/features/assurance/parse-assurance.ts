import {
  controlCoverageSchema,
  kirkpatrickSchema,
  residualRiskSchema,
  safeParsePayload,
} from "@/lib/schemas/payloads";
import type { AssuranceSnapshotView } from "@/lib/api/generated/openapi.types";
import { formatRatioPercent } from "@/lib/format/score";

export type KirkpatrickLevelKey = "L1" | "L2" | "L3" | "L4";

export type ParsedKirkpatrickLevel = {
  key: KirkpatrickLevelKey;
  label: string;
  raw: Record<string, unknown> | null;
  status?: string;
  note?: string;
  level3Proofs?: number;
  attempts?: number;
  coverageProxy?: number;
  kind: "Measured" | "Modelled" | "Assumption" | "Unknown";
  green: boolean;
};

const LEVEL_META: Array<{
  key: KirkpatrickLevelKey;
  label: string;
  aliases: string[];
}> = [
  {
    key: "L1",
    label: "L1 Reaction",
    aliases: ["L1_reaction", "l1", "level_1"],
  },
  {
    key: "L2",
    label: "L2 Learning",
    aliases: ["L2_learning", "l2", "level_2"],
  },
  {
    key: "L3",
    label: "L3 Behaviour",
    aliases: ["L3_behavior", "l3", "level_3"],
  },
  {
    key: "L4",
    label: "L4 Results",
    aliases: ["L4_results", "l4", "level_4"],
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseKirkpatrick(raw: unknown): ParsedKirkpatrickLevel[] {
  const parsed = safeParsePayload(kirkpatrickSchema, raw);
  const data = parsed.ok ? parsed.data : asRecord(raw) ?? {};

  return LEVEL_META.map((meta) => {
    let levelRaw: Record<string, unknown> | null = null;
    for (const alias of meta.aliases) {
      const candidate = asRecord((data as Record<string, unknown>)[alias]);
      if (candidate) {
        levelRaw = candidate;
        break;
      }
    }

    const status =
      typeof levelRaw?.status === "string" ? levelRaw.status : undefined;
    const note = typeof levelRaw?.note === "string" ? levelRaw.note : undefined;
    const level3Proofs =
      typeof levelRaw?.level3_proofs === "number"
        ? levelRaw.level3_proofs
        : undefined;
    const attempts =
      typeof levelRaw?.attempts === "number" ? levelRaw.attempts : undefined;
    const coverageProxy =
      typeof levelRaw?.coverage_score_proxy === "number"
        ? levelRaw.coverage_score_proxy
        : undefined;

    if (meta.key === "L3") {
      const hasProof = (level3Proofs ?? 0) > 0;
      return {
        key: meta.key,
        label: meta.label,
        raw: levelRaw,
        status,
        note,
        level3Proofs,
        attempts,
        kind: hasProof ? ("Measured" as const) : ("Unknown" as const),
        green: hasProof,
      };
    }

    if (meta.key === "L4") {
      return {
        key: meta.key,
        label: meta.label,
        raw: levelRaw,
        status,
        note,
        coverageProxy,
        kind:
          status === "assumption_only"
            ? ("Assumption" as const)
            : ("Modelled" as const),
        green: false,
      };
    }

    return {
      key: meta.key,
      label: meta.label,
      raw: levelRaw,
      status,
      note,
      kind: "Measured" as const,
      green: false,
    };
  });
}

export function parseResidualRisk(raw: unknown) {
  const parsed = safeParsePayload(residualRiskSchema, raw);
  if (!parsed.ok) {
    return {
      ok: false as const,
      error: parsed.error,
      raw: parsed.raw,
      score: null as number | null,
      unproven: null as number | null,
      partial: null as number | null,
      assignments: null as number | null,
      clauses: null as number | null,
      scoreText: "Unknown" as string,
      scoreWarning: undefined as string | undefined,
    };
  }
  const d = parsed.data;
  const score =
    typeof d.residual_capability_risk === "number"
      ? d.residual_capability_risk
      : typeof d.score === "number"
        ? d.score
        : null;
  const fmt = formatRatioPercent(score);
  return {
    ok: true as const,
    score,
    unproven:
      typeof d.unproven_employees === "number" ? d.unproven_employees : null,
    partial:
      typeof d.partial_proof_employees === "number"
        ? d.partial_proof_employees
        : null,
    assignments: typeof d.assignments === "number" ? d.assignments : null,
    clauses:
      typeof d.policy_clauses_linked === "number"
        ? d.policy_clauses_linked
        : null,
    summary: typeof d.summary === "string" ? d.summary : undefined,
    level: typeof d.level === "string" ? d.level : undefined,
    scoreText: fmt.text,
    scoreWarning: fmt.warning,
    raw: d,
  };
}

export function parseControlCoverage(raw: unknown) {
  const parsed = safeParsePayload(controlCoverageSchema, raw);
  if (!parsed.ok) {
    return {
      ok: false as const,
      error: parsed.error,
      raw: parsed.raw,
    };
  }
  const d = parsed.data;
  const coverage =
    typeof d.gap_coverage_score === "number"
      ? d.gap_coverage_score
      : typeof d.coverage === "number"
        ? d.coverage
        : null;
  const fmt = formatRatioPercent(coverage);
  return {
    ok: true as const,
    selectedOptionKey: d.selected_option_key ?? null,
    coverage,
    coverageText: fmt.text,
    coverageWarning: fmt.warning,
    hardConstraintOk:
      typeof d.hard_constraint_ok === "boolean" ? d.hard_constraint_ok : null,
    raw: d,
  };
}

/** API returns newest-first; chart needs chronological without mutating cache. */
export function chronologicalSnapshots(
  snapshots: AssuranceSnapshotView[] | undefined,
): AssuranceSnapshotView[] {
  if (!snapshots?.length) return [];
  return [...snapshots].reverse();
}

export function latestSnapshot(
  snapshots: AssuranceSnapshotView[] | undefined,
): AssuranceSnapshotView | null {
  if (!snapshots?.length) return null;
  return snapshots[0] ?? null;
}
