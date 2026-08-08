"use client";

import { use } from "react";
import { usePathname } from "next/navigation";
import { RunSidebar } from "@/components/shell/run-sidebar";
import { RunContextBar } from "@/components/shell/run-context-bar";
import { RunLiveSync } from "@/components/shell/run-live-sync";

export default function RunWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const pathname = usePathname();
  const isTheatre = pathname.includes("/simulate/");

  if (isTheatre) {
    return <div className="h-full min-h-0 overflow-hidden">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0">
      <RunSidebar runId={runId} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <RunContextBar runId={runId} />
        <RunLiveSync runId={runId} />
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
