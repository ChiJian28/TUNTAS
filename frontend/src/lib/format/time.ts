import { formatInTimeZone } from "date-fns-tz";

const TZ = "Asia/Kuala_Lumpur";

export function formatKl(iso: string | null | undefined, pattern = "dd MMM yyyy HH:mm"): string {
  if (!iso) return "—";
  try {
    return formatInTimeZone(new Date(iso), TZ, pattern);
  } catch {
    return iso;
  }
}

export function formatKlShort(iso: string | null | undefined): string {
  return formatKl(iso, "dd MMM HH:mm");
}

/** Clock time in KL for timeline event rows, e.g. 17:14:22 */
export function formatKlClock(iso: string | null | undefined): string {
  return formatKl(iso, "HH:mm:ss");
}

/** Minute bucket label in KL, e.g. 17:14 */
export function formatKlMinute(iso: string | null | undefined): string {
  return formatKl(iso, "HH:mm");
}

/** Stable minute group key in KL (date + minute). */
export function klMinuteKey(iso: string | null | undefined): string {
  return formatKl(iso, "yyyy-MM-dd HH:mm");
}

export function formatRelativeRefresh(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, TZ, "HH:mm:ss");
}
