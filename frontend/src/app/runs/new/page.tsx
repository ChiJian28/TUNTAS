"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createRun,
  executeRun,
  invalidateAfterCreate,
  invalidateAfterExecute,
} from "@/lib/api/mutations";
import { normalizeApiError, TuntasApiError } from "@/lib/api/errors";
import { formatMyr } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type Step = 1 | 2 | 3 | 4;

type ParsedTrigger = {
  raw: Record<string, unknown>;
  request?: Record<string, unknown>;
  employees: Record<string, unknown>[];
};

function tryParseTrigger(text: string): { ok: true; data: ParsedTrigger } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON syntax" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Root must be an object" };
  }
  const root = parsed as Record<string, unknown>;
  const request =
    root.request && typeof root.request === "object" && !Array.isArray(root.request)
      ? (root.request as Record<string, unknown>)
      : undefined;
  const employees = Array.isArray(root.employees)
    ? (root.employees as Record<string, unknown>[])
    : Array.isArray(request?.employees)
      ? (request!.employees as Record<string, unknown>[])
      : [];
  if (!request && employees.length === 0) {
    return {
      ok: false,
      error: "Expected a `request` object and/or `employees` array",
    };
  }
  const refs = employees
    .map((e) => String(e.employee_ref ?? e.id ?? e.pseudonym ?? ""))
    .filter(Boolean);
  const dup = refs.filter((r, i) => refs.indexOf(r) !== i);
  if (dup.length) {
    return { ok: false, error: `Duplicate employee refs: ${[...new Set(dup)].join(", ")}` };
  }
  return { ok: true, data: { raw: root, request, employees } };
}

function aggregate(employees: Record<string, unknown>[]) {
  const roles = new Map<string, number>();
  const units = new Map<string, number>();
  const locations = new Map<string, number>();
  for (const e of employees) {
    const role = String(e.role_title ?? e.role_code ?? e.role ?? "Unknown");
    const unit = String(e.unit ?? "Unknown");
    const loc = String(e.location ?? "Unknown");
    roles.set(role, (roles.get(role) ?? 0) + 1);
    units.set(unit, (units.get(unit) ?? 0) + 1);
    locations.set(loc, (locations.get(loc) ?? 0) + 1);
  }
  return { roles, units, locations, count: employees.length };
}

export default function NewRunPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const pushMutation = useUiStore((s) => s.pushMutation);
  const popMutation = useUiStore((s) => s.popMutation);

  const [step, setStep] = useState<Step>(1);
  const [paste, setPaste] = useState("");
  const [useSynthetic, setUseSynthetic] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedTrigger | null>(null);
  const [executeWarning, setExecuteWarning] = useState<string | null>(null);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const text = await file.text();
    setPaste(text);
    setUseSynthetic(false);
    const result = tryParseTrigger(text);
    if (!result.ok) {
      setParseError(result.error);
      setParsed(null);
    } else {
      setParseError(null);
      setParsed(result.data);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/json": [".json"] },
    multiple: false,
  });

  const privacy = useMemo(
    () => (parsed ? aggregate(parsed.employees) : null),
    [parsed],
  );

  const request = parsed?.request;

  function applyPaste() {
    if (useSynthetic) {
      setParseError(null);
      setParsed(null);
      return;
    }
    const result = tryParseTrigger(paste);
    if (!result.ok) {
      setParseError(result.error);
      setParsed(null);
      return;
    }
    setParseError(null);
    setParsed(result.data);
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (useSynthetic) {
        return createRun({ use_synthetic_fallback: true });
      }
      if (!parsed) throw new Error("No trigger payload");
      return createRun({
        trigger_payload: parsed.raw,
        use_synthetic_fallback: false,
      });
    },
    onSuccess: (res) => {
      invalidateAfterCreate(qc);
      router.push(`/runs/${res.run_id}/overview`);
      // Fire execute after navigation is scheduled
      void runExecute(res.run_id);
    },
    onError: (err) => {
      toast.error(normalizeApiError(err).message);
    },
  });

  async function runExecute(runId: string) {
    const mid = pushMutation("Executing LangGraph…");
    try {
      const res = await executeRun(runId);
      toast.success(res.message || `Status: ${res.status}`);
      invalidateAfterExecute(qc, runId);
      setExecuteWarning(null);
    } catch (err) {
      const e = normalizeApiError(err) as TuntasApiError;
      // Timeout / network: refetch only — do not auto-retry execute
      setExecuteWarning(
        `Execute did not return cleanly (${e.message}). Refetching run state — not auto-retrying execute.`,
      );
      toast.error(e.message);
      invalidateAfterExecute(qc, runId);
    } finally {
      popMutation(mid);
    }
  }

  const canNextFrom1 = useSynthetic || (!!parsed && !parseError);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
          Intake
        </p>
        <h1 className="font-display text-4xl text-[var(--foreground)]">
          New capability run
        </h1>
        <p className="text-sm text-[var(--body)]">
          Upload or paste a trigger JSON, or explicitly opt into the synthetic demo
          fixture. Browser never sends a server filesystem `trigger_path`.
        </p>
        <div className="flex gap-2 text-xs">
          {[1, 2, 3, 4].map((s) => (
            <Badge key={s} variant={step === s ? "soft-primary" : "muted"}>
              Step {s}
            </Badge>
          ))}
        </div>
      </header>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
            <CardDescription>
              Choose exactly one source. Synthetic demo data must be explicit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              {...getRootProps()}
              className={cn(
                "cursor-pointer rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-8 text-center",
                isDragActive && "border-[var(--primary)] bg-[var(--primary-soft)]",
              )}
            >
              <input {...getInputProps()} />
              <p className="text-sm text-[var(--body)]">
                Drag & drop a `.json` trigger, or click to browse
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paste">Or paste JSON</Label>
              <Textarea
                id="paste"
                rows={10}
                className="font-mono text-xs"
                value={paste}
                onChange={(e) => {
                  setPaste(e.target.value);
                  setUseSynthetic(false);
                }}
                disabled={useSynthetic}
              />
              <Button type="button" variant="outline" size="sm" onClick={applyPaste}>
                Validate paste
              </Button>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--warning-soft)] p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={useSynthetic}
                onChange={(e) => {
                  setUseSynthetic(e.target.checked);
                  if (e.target.checked) {
                    setParsed(null);
                    setParseError(null);
                  }
                }}
              />
              <span>
                <strong>Use synthetic demo fixture</strong>
                <span className="mt-1 block text-[var(--muted-foreground)]">
                  Explicit opt-in. UI will show a Demo Data badge. Never applied silently.
                </span>
              </span>
            </label>
            {parseError ? (
              <p className="text-sm text-[var(--destructive)]">{parseError}</p>
            ) : null}
            {useSynthetic ? <Badge variant="warning">Demo Data</Badge> : null}
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!canNextFrom1}
                onClick={() => {
                  if (!useSynthetic) applyPaste();
                  if (useSynthetic || parsed) setStep(2);
                }}
              >
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Privacy preview</CardTitle>
            <CardDescription>
              PII will be pseudonymised before model access. Only aggregates are shown here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {useSynthetic ? (
              <p className="text-sm">
                Synthetic fixture selected — employee PII is already pseudonymous in the
                demo pack. Exact counts come from the backend after create.
              </p>
            ) : privacy ? (
              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <AggBlock title="Roles" map={privacy.roles} />
                <AggBlock title="Units" map={privacy.units} />
                <AggBlock title="Locations" map={privacy.locations} />
                <p className="sm:col-span-3 text-[var(--muted-foreground)]">
                  Employees in payload: {privacy.count}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--destructive)]">No parsed employees.</p>
            )}
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="button" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Constraint review</CardTitle>
            <CardDescription>
              Values only from your payload / synthetic path — nothing is hard-coded here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {useSynthetic ? (
              <p>
                Constraints will be taken from the backend synthetic fixture after create.
                This UI does not invent RM5,000 / RM1.25m / Q3 / 250.
              </p>
            ) : (
              <dl className="space-y-2">
                <Row
                  label="Employee cap / budget per employee"
                  value={numField(request, [
                    "max_budget_per_employee_myr",
                    "max_cost_per_employee_myr",
                    "employee_budget_cap_myr",
                  ])}
                />
                <Row
                  label="Total budget"
                  value={numField(request, ["total_budget_myr", "budget_total_myr"])}
                />
                <Row
                  label="Training window"
                  value={windowField(request)}
                />
                <Row
                  label="Operational coverage"
                  value={ratioField(request, [
                    "min_operational_coverage_ratio",
                    "operational_coverage",
                  ])}
                />
                <Row
                  label="Frameworks"
                  value={arrayField(request, ["frameworks", "framework_codes"])}
                />
                <Row label="Employee count" value={String(parsed?.employees.length ?? "—")} />
              </dl>
            )}
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button type="button" onClick={() => setStep(4)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle>Create + Execute</CardTitle>
            <CardDescription>
              Create returns a run ID first; overview opens immediately; execute then runs
              (may take minutes). On timeout we refetch — we do not auto-retry execute.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {useSynthetic ? <Badge variant="warning">Demo Data</Badge> : null}
            {executeWarning ? (
              <p className="text-sm text-[var(--warning)]">{executeWarning}</p>
            ) : null}
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button
                type="button"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? "Creating…" : "Create run & execute"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function AggBlock({ title, map }: { title: string; map: Map<string, number> }) {
  return (
    <div>
      <p className="mb-1 font-medium text-[var(--foreground)]">{title}</p>
      <ul className="space-y-1 text-[var(--muted-foreground)]">
        {[...map.entries()].map(([k, v]) => (
          <li key={k}>
            {k}: {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--border)] py-2">
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="font-mono text-[var(--foreground)] text-right">{value}</dd>
    </div>
  );
}

function numField(req: Record<string, unknown> | undefined, keys: string[]): string {
  if (!req) return "Not in payload";
  for (const k of keys) {
    const v = req[k];
    if (typeof v === "number") return formatMyr(v);
  }
  return "Not in payload";
}

function ratioField(req: Record<string, unknown> | undefined, keys: string[]): string {
  if (!req) return "Not in payload";
  for (const k of keys) {
    const v = req[k];
    if (typeof v === "number") {
      if (v >= 0 && v <= 1) return `${(v * 100).toFixed(0)}%`;
      return String(v);
    }
  }
  return "Not in payload";
}

function arrayField(req: Record<string, unknown> | undefined, keys: string[]): string {
  if (!req) return "Not in payload";
  for (const k of keys) {
    const v = req[k];
    if (Array.isArray(v) && v.length) return v.map(String).join(", ");
  }
  return "Not in payload";
}

function windowField(req: Record<string, unknown> | undefined): string {
  if (!req) return "Not in payload";
  const start = req.training_window_start ?? req.window_start ?? req.q3_start;
  const end = req.training_window_end ?? req.window_end ?? req.q3_end;
  if (start || end) return `${String(start ?? "—")} → ${String(end ?? "—")}`;
  return "Not in payload";
}
