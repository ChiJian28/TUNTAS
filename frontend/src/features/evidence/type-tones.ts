/** Shared Evidence Spine type → colour accents (nodes + filters). */

export type EvidenceTypeTone = {
  key: string;
  accent: string;
  softBg: string;
  softText: string;
};

export const LEGEND_TYPES: EvidenceTypeTone[] = [
  {
    key: "policy",
    accent: "var(--evidence)",
    softBg: "bg-[var(--evidence-soft)]",
    softText: "text-[var(--evidence)]",
  },
  {
    key: "control",
    accent: "var(--border-strong)",
    softBg: "bg-[var(--surface-emphasis)]",
    softText: "text-[var(--foreground)]",
  },
  {
    key: "competency",
    accent: "var(--warning)",
    softBg: "bg-[var(--warning-soft)]",
    softText: "text-[var(--warning)]",
  },
  {
    key: "employee",
    accent: "var(--primary)",
    softBg: "bg-[var(--primary-soft)]",
    softText: "text-[var(--primary)]",
  },
  {
    key: "course",
    accent: "var(--success)",
    softBg: "bg-[var(--success-soft)]",
    softText: "text-[var(--success)]",
  },
  {
    key: "approval",
    accent: "var(--destructive)",
    softBg: "bg-[var(--destructive-soft)]",
    softText: "text-[var(--destructive)]",
  },
  {
    key: "artifact",
    accent: "var(--muted-foreground)",
    softBg: "bg-[var(--surface)]",
    softText: "text-[var(--muted-foreground)]",
  },
];

const FALLBACK: EvidenceTypeTone = {
  key: "default",
  accent: "var(--border-strong)",
  softBg: "bg-[var(--surface)]",
  softText: "text-[var(--muted-foreground)]",
};

export function toneForType(nodeType: string): EvidenceTypeTone {
  const t = nodeType.toLowerCase();
  if (t.includes("provider")) {
    return LEGEND_TYPES.find((x) => x.key === "course") ?? FALLBACK;
  }
  for (const tone of LEGEND_TYPES) {
    if (t.includes(tone.key)) return tone;
  }
  if (t.includes("readiness") || t.includes("simulation") || t.includes("assurance")) {
    return {
      key: t,
      accent: "var(--evidence)",
      softBg: "bg-[var(--evidence-soft)]",
      softText: "text-[var(--evidence)]",
    };
  }
  return FALLBACK;
}
