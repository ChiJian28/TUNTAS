"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ClipboardCheck,
  FileSearch,
  GitPullRequest,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Truck,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { apiQueries } from "@/lib/api/queries";
import { REVIEW_GATES, reviewHref } from "@/lib/constants/gates";

const TOP_SECTIONS = [
  { slug: "overview", label: "Overview", icon: LayoutDashboard },
  { slug: "evidence", label: "Evidence", icon: FileSearch },
  { slug: "delivery", label: "Delivery", icon: Truck },
  { slug: "assurance", label: "Assurance", icon: ShieldCheck },
  { slug: "audit", label: "Audit", icon: ClipboardCheck },
] as const;

const EXPANDED_WIDTH = "232px";
const COLLAPSED_WIDTH = "56px";

export function RunSidebar({
  runId,
  className,
}: {
  runId: string;
  className?: string;
}) {
  const pathname = usePathname();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const reviewActive = pathname.includes(`/runs/${runId}/review`);
  const [reviewOpen, setReviewOpen] = useState(reviewActive);
  const gates = useQuery(apiQueries.gates(runId));

  useEffect(() => {
    if (reviewActive) setReviewOpen(true);
  }, [reviewActive]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("tuntas.sidebarCollapsed");
      if (stored === "1" || stored === "0") {
        setSidebarCollapsed(stored === "1");
      }
    } catch {
      /* ignore */
    }
  }, [setSidebarCollapsed]);

  useEffect(() => {
    const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
    document.documentElement.style.setProperty("--sidebar-width", width);
    return () => {
      document.documentElement.style.setProperty("--sidebar-width", "0px");
    };
  }, [collapsed]);

  const currentGate = gates.data?.current_gate ?? "compliance";

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200",
        collapsed ? "w-14" : "w-[var(--sidebar-width)]",
        className,
      )}
      style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div
        className={cn(
          "flex border-b border-[var(--border)]",
          collapsed
            ? "flex-col items-center gap-2 px-1.5 py-3"
            : "items-start justify-between gap-2 px-3 py-3",
        )}
      >
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg text-[var(--foreground)]">
              Assurance
            </p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-foreground)]">
              {runId}
            </p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 shrink-0 p-0", collapsed && "mx-auto")}
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col gap-1 p-2",
          collapsed && "items-center",
        )}
        aria-label="Run sections"
      >
        <NavLink
          href={`/runs/${runId}/overview`}
          label="Overview"
          icon={LayoutDashboard}
          collapsed={collapsed}
          active={pathname.includes("/overview")}
        />

        {collapsed ? (
          <NavLink
            href={reviewHref(runId, currentGate)}
            label="Review"
            icon={GitPullRequest}
            collapsed
            active={reviewActive}
          />
        ) : (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setReviewOpen((v) => !v)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm",
                reviewActive
                  ? "bg-[var(--primary-soft)] text-[var(--foreground)]"
                  : "text-[var(--body)] hover:bg-[var(--surface-emphasis)]",
              )}
              aria-expanded={reviewOpen}
            >
              <GitPullRequest
                className={cn(
                  "size-4 shrink-0",
                  reviewActive
                    ? "text-[var(--primary)]"
                    : "text-[var(--muted-foreground)]",
                )}
                aria-hidden
              />
              <span className={cn("flex-1 text-left", reviewActive && "font-medium")}>
                Review
              </span>
              <ChevronDown
                className={cn(
                  "size-3.5 text-[var(--muted-foreground)] transition-transform",
                  reviewOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            {reviewOpen ? (
              <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
                {REVIEW_GATES.map((item) => {
                  const href = reviewHref(runId, item.key);
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  const g = gates.data?.gates.find((row) => row.gate_key === item.key);
                  const mark =
                    g?.status === "approved"
                      ? "✓"
                      : g?.status === "skipped"
                        ? "—"
                        : g?.status === "active" || gates.data?.current_gate === item.key
                          ? "●"
                          : "";
                  return (
                    <Link
                      key={item.key}
                      href={href}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px]",
                        active
                          ? "bg-[var(--primary-soft)] font-medium text-[var(--foreground)]"
                          : "text-[var(--body)] hover:bg-[var(--surface-emphasis)]",
                        g?.status === "skipped" && "text-[var(--muted-foreground)]",
                      )}
                    >
                      <span>{item.label}</span>
                      <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                        {mark}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}

        {TOP_SECTIONS.filter((s) => s.slug !== "overview").map(
          ({ slug, label, icon }) => (
            <NavLink
              key={slug}
              href={`/runs/${runId}/${slug}`}
              label={label}
              icon={icon}
              collapsed={collapsed}
              active={pathname.includes(`/${slug}`)}
            />
          ),
        )}
      </nav>

      <div
        className={cn(
          "border-t border-[var(--border)]",
          collapsed ? "flex justify-center p-2" : "p-3",
        )}
      >
        <Link
          href="/runs"
          title="Run Center"
          aria-label="Back to Run Center"
          className={cn(
            "text-[var(--link)] hover:underline",
            collapsed
              ? "flex size-10 items-center justify-center rounded-xl hover:bg-[var(--surface-emphasis)] hover:no-underline"
              : "inline-flex items-center gap-1 text-xs",
          )}
        >
          {collapsed ? (
            <ArrowLeft className="size-4" aria-hidden />
          ) : (
            "← Run Center"
          )}
        </Link>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cn(
        "relative flex items-center rounded-xl text-sm transition-colors",
        collapsed ? "size-10 justify-center" : "gap-2.5 px-3 py-2.5",
        active
          ? "bg-[var(--primary-soft)] text-[var(--foreground)]"
          : "text-[var(--body)] hover:bg-[var(--surface-emphasis)]",
      )}
    >
      {active && !collapsed ? (
        <span
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-[var(--primary)]"
          aria-hidden
        />
      ) : null}
      {active && collapsed ? (
        <span
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-[var(--primary)]"
          aria-hidden
        />
      ) : null}
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]",
        )}
        aria-hidden
      />
      {!collapsed ? (
        <span className={cn(active && "font-medium")}>{label}</span>
      ) : null}
    </Link>
  );
}
