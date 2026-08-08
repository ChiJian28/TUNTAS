/** Coverage/score contract: only treat 0..1 as ratio; otherwise show raw. */
export function formatRatioPercent(
  value: number | null | undefined,
  digits = 0,
): { text: string; warning?: string } {
  if (value == null || Number.isNaN(value)) {
    return { text: "Unknown" };
  }
  if (value >= 0 && value <= 1) {
    return { text: `${(value * 100).toFixed(digits)}%` };
  }
  return {
    text: String(value),
    warning: "Value outside 0–1; shown raw (not clamped)",
  };
}

export function formatNullableNumber(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  return value.toFixed(digits);
}
