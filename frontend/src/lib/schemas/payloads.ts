import { z } from "zod";

export const apiErrorDetailSchema = z.union([
  z.string(),
  z.object({ message: z.string().optional() }).passthrough(),
  z.array(
    z.object({
      loc: z.array(z.union([z.string(), z.number()])).optional(),
      msg: z.string().optional(),
      type: z.string().optional(),
    }),
  ),
]);

export const handoffEnvelopeSchema = z
  .object({
    schema_version: z.string().optional(),
    source_agent: z.string().optional(),
    evidence_ids: z.array(z.string()).optional(),
    confidence: z.number().optional(),
    input_hash: z.string().optional(),
    requires_review: z.boolean().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();

export const competencyGapSchema = z
  .object({
    competency_code: z.string().optional(),
    fsf_code: z.string().optional(),
    code: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    current_level: z.number().optional(),
    target_level: z.number().optional(),
    priority: z.union([z.string(), z.number()]).optional(),
    gap_priority: z.union([z.string(), z.number()]).optional(),
    gap: z.number().optional(),
  })
  .passthrough();

export const vendorCourseSchema = z
  .object({
    provider: z.string().optional(),
    provider_name: z.string().optional(),
    provider_code: z.string().optional(),
    provider_website: z.string().optional(),
    course: z.string().optional(),
    course_code: z.string().optional(),
    code: z.string().optional(),
    title: z.string().optional(),
    cost_myr: z.union([z.number(), z.string()]).optional(),
    price_myr: z.union([z.number(), z.string()]).optional(),
    price_status: z.string().optional(),
    delivery_mode: z.string().optional(),
    hrd_corp_claimable: z.boolean().optional(),
    data_residency: z.string().optional(),
    evidence_freshness: z.string().optional(),
    class_capacity: z.union([z.number(), z.string()]).optional(),
    prerequisites: z.array(z.string()).optional(),
    prerequisite_codes: z.array(z.string()).optional(),
    evidence_url: z.string().optional(),
    quote_required: z.boolean().optional(),
    privacy_flags: z.array(z.string()).optional(),
    source: z.string().optional(),
    q3_availability: z.union([z.string(), z.boolean()]).optional(),
  })
  .passthrough();

export const vendorLiveEvidenceSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().optional(),
    snippet: z.string().optional(),
    source: z.string().optional(),
    retrieved_at: z.string().optional(),
  })
  .passthrough();

export const diagnosticPayloadSchema = z
  .object({
    summary: z.string().optional(),
    priority_gaps: z.array(z.record(z.string(), z.unknown())).optional(),
    cohort_risk_statement: z.string().optional(),
    gap_frequency: z.record(z.string(), z.number()).optional(),
    employee_count: z.number().optional(),
    role_breakdown: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

export const policyPayloadSchema = z
  .object({
    control_mappings: z.array(z.record(z.string(), z.unknown())).optional(),
    nsc07_tc17_note: z.string().optional(),
    clauses: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const learningPayloadSchema = z
  .object({
    curriculum_modules: z.array(z.record(z.string(), z.unknown())).optional(),
    scenarios: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export const vendorPayloadSchema = z
  .object({
    shortlist_notes: z.string().optional(),
    risk_flags: z.array(z.record(z.string(), z.unknown())).optional(),
    mode_used: z.string().optional(),
    /** Per-course Zod runs in the UI — keep unknown here so one bad row doesn't kill the panel. */
    courses: z.array(z.unknown()).optional(),
    live_evidence: z.array(vendorLiveEvidenceSchema).optional(),
    queries_used: z.array(z.string()).optional(),
    live_evidence_count: z.number().optional(),
    tavily_authenticated: z.boolean().optional(),
    retrieved_at: z.string().optional(),
  })
  .passthrough();

export const challengerFlagSchema = z
  .object({
    severity: z.string().optional(),
    code: z.string().optional(),
    flag: z.string().optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
    course_code: z.string().optional(),
    option_key: z.string().optional(),
    veto: z.boolean().optional(),
    evidence_insufficient: z.boolean().optional(),
  })
  .passthrough();

export const challengerPayloadSchema = z
  .object({
    vetoes: z.array(challengerFlagSchema).optional(),
    option_flags: z.array(challengerFlagSchema).optional(),
    overall_recommendation: z.string().optional(),
    evidence_insufficient: z.array(challengerFlagSchema).optional(),
  })
  .passthrough();

export const secretariatPayloadSchema = z
  .object({
    decision_brief: z.string().optional(),
    questions_for_manager: z.array(z.string()).optional(),
    recommended_option_key: z.string().optional(),
  })
  .passthrough();

export function gapCode(gap: z.infer<typeof competencyGapSchema>): string {
  return gap.fsf_code || gap.code || gap.competency_code || gap.label || "UNKNOWN";
}

export function gapLabel(gap: z.infer<typeof competencyGapSchema>): string {
  return gap.name || gap.label || gapCode(gap);
}

export function displayOrUnknown(
  value: string | number | boolean | null | undefined,
): string {
  if (value == null || value === "") return "Unknown";
  return String(value);
}

export function isSafeHttpUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const kirkpatrickSchema = z
  .object({
    l1: z.unknown().optional(),
    l2: z.unknown().optional(),
    l3: z.unknown().optional(),
    l4: z.unknown().optional(),
    level_1: z.unknown().optional(),
    level_2: z.unknown().optional(),
    level_3: z.unknown().optional(),
    level_4: z.unknown().optional(),
    L1_reaction: z.unknown().optional(),
    L2_learning: z.unknown().optional(),
    L3_behavior: z.unknown().optional(),
    L4_results: z.unknown().optional(),
  })
  .passthrough();

export const residualRiskSchema = z
  .object({
    score: z.number().optional(),
    level: z.string().optional(),
    summary: z.string().optional(),
    residual_capability_risk: z.number().optional(),
    unproven_employees: z.number().optional(),
    partial_proof_employees: z.number().optional(),
    assignments: z.number().optional(),
    policy_clauses_linked: z.number().optional(),
  })
  .passthrough();

export const controlCoverageSchema = z
  .object({
    selected_option_key: z.string().optional(),
    gap_coverage_score: z.number().optional(),
    hard_constraint_ok: z.boolean().optional(),
    coverage: z.number().optional(),
    controls_covered: z.number().optional(),
    controls_total: z.number().optional(),
  })
  .passthrough();

export const scenarioRubricItemSchema = z
  .object({
    criterion: z.string().optional(),
    weight: z.number().optional(),
    level3_behavior: z.string().optional(),
    required_signals: z.array(z.string()).optional(),
    critical: z.boolean().optional(),
  })
  .passthrough();

export const adaptiveTurnSchema = z
  .object({
    turn: z.number().optional(),
    turn_index: z.number().optional(),
    role: z.string().optional(),
    speaker: z.string().optional(),
    text: z.string().optional(),
    narrative: z.string().optional(),
    content: z.string().optional(),
    action: z.string().optional(),
    actions: z.array(z.string()).optional(),
    narrator: z.string().optional(),
    npc_message: z.string().optional(),
    situation: z.string().optional(),
    complication: z.string().optional(),
    choices_hint: z.array(z.string()).optional(),
    observed_signals: z.array(z.string()).optional(),
    difficulty: z.string().optional(),
    continue: z.boolean().optional(),
  })
  .passthrough();

export const simulationFeedbackSchema = z
  .object({
    text: z.string().optional(),
    criterion_scores: z.array(z.record(z.string(), z.unknown())).optional(),
    proof_of_level3: z.boolean().optional(),
    scoring_method: z.string().optional(),
    critical_fail: z.boolean().optional(),
  })
  .passthrough();

export function safeParsePayload<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { ok: true; data: T } | { ok: false; error: string; raw: unknown } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  if (process.env.NODE_ENV === "development") {
    console.warn("[schema]", result.error.message, data);
  }
  return { ok: false, error: result.error.message, raw: data };
}

export function parseHandoffEnvelope(outputJson: Record<string, unknown>) {
  return safeParsePayload(handoffEnvelopeSchema, outputJson);
}
