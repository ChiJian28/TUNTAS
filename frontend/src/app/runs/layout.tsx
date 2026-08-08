import { ApiHealthIndicator } from "@/components/shell/api-health-indicator";
import { ApiTraceDrawer } from "@/components/shell/api-trace-drawer";
import { BrandLogo } from "@/components/shell/brand-logo";
import { MutationTray } from "@/components/shell/mutation-tray";

export default function RunsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--background)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-raised)] px-6 py-3">
        <BrandLogo />
        <ApiHealthIndicator />
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      <MutationTray />
      <ApiTraceDrawer />
    </div>
  );
}
