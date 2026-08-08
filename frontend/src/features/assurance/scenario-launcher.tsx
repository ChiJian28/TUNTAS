"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GOLDEN_SCENARIOS } from "@/lib/constants/agents";
import type { EmployeeListItem, ScenarioView } from "@/lib/api/generated/openapi.types";

type Props = {
  runId: string;
  scenarios: ScenarioView[];
  employees: EmployeeListItem[];
};

export function ScenarioLauncher({ runId, scenarios, employees }: Props) {
  const [employeeRef, setEmployeeRef] = useState(
    employees[0]?.employee_ref ?? "",
  );
  const [manualEmployee, setManualEmployee] = useState("");

  const effectiveEmployee = manualEmployee.trim() || employeeRef;

  const ordered = useMemo(() => {
    const goldenSet = new Set<string>(GOLDEN_SCENARIOS);
    const golden = GOLDEN_SCENARIOS.map((code) =>
      scenarios.find((s) => s.code === code),
    ).filter(Boolean) as ScenarioView[];
    const rest = scenarios.filter((s) => !goldenSet.has(s.code));
    return [...golden, ...rest];
  }, [scenarios]);

  if (!scenarios.length) {
    return (
      <EmptyState
        title="No scenarios available"
        description="Scenarios are created by the Learning Architect during run execution."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Label htmlFor="employee-select">Employee (pseudonymous)</Label>
          {employees.length > 0 ? (
            <Select value={employeeRef} onValueChange={setEmployeeRef}>
              <SelectTrigger id="employee-select">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.employee_ref} value={e.employee_ref}>
                    {e.pseudonym || e.employee_ref}
                    {e.role_title ? ` · ${e.role_title}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="employee-select"
              placeholder="EMP-…"
              value={manualEmployee}
              onChange={(ev) => setManualEmployee(ev.target.value)}
            />
          )}
        </div>
        {employees.length > 0 ? (
          <div className="min-w-[180px] flex-1 space-y-1.5">
            <Label htmlFor="employee-manual">Or paste employee ref</Label>
            <Input
              id="employee-manual"
              placeholder="Override EMP-…"
              value={manualEmployee}
              onChange={(ev) => setManualEmployee(ev.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ordered.map((scenario) => {
          const isGolden = (GOLDEN_SCENARIOS as readonly string[]).includes(
            scenario.code,
          );
          const href = effectiveEmployee
            ? `/runs/${runId}/simulate/${scenario.id}?employee=${encodeURIComponent(effectiveEmployee)}`
            : undefined;

          return (
            <Card key={scenario.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{scenario.title}</CardTitle>
                    <p className="font-mono text-xs text-[var(--muted-foreground)]">
                      {scenario.code}
                    </p>
                  </div>
                  {isGolden ? (
                    <Badge variant="soft-primary">Golden</Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-[var(--body)]">
                  Role focus:{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {scenario.role_focus}
                  </span>
                </p>
                {href ? (
                  <Button asChild size="sm">
                    <Link href={href}>
                      <Play className="size-3.5" aria-hidden />
                      Launch adaptive drill
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    Select employee to launch
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
