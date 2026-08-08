const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  maximumFractionDigits: 0,
});

export function formatMyr(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "Unknown";
  return myr.format(value);
}
