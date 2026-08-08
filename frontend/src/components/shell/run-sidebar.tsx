"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  ClipboardCheck,
  FileSearch,
  LayoutDashboard,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Truck,
  ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const SECTIONS = [
  { slug: "overview", label: "Overview", icon: LayoutDashboard },
  { slug: "plan", label: "Plan", icon: Map },
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
        {SECTIONS.map(({ slug, label, icon: Icon }) => {
          const href = `/runs/${runId}/${slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={slug}
              href={href}
              title={label}
              aria-label={label}
              className={cn(
                "relative flex items-center rounded-xl text-sm transition-colors",
                collapsed
                  ? "size-10 justify-center"
                  : "gap-2.5 px-3 py-2.5",
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
                  active
                    ? "text-[var(--primary)]"
                    : "text-[var(--muted-foreground)]",
                )}
                aria-hidden
              />
              {!collapsed ? (
                <span className={cn(active && "font-medium")}>{label}</span>
              ) : null}
            </Link>
          );
        })}
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
