import { create } from "zustand";

type WhatIfDraft = {
  maxCostPerEmployeeMyr?: number;
  totalBudgetMyr?: number;
  minOperationalCoverageRatio?: number;
};

type MutationActivity = {
  id: string;
  label: string;
  startedAt: string;
};

type UiState = {
  proofLensEnabled: boolean;
  selectedOptionKey: string | null;
  selectedEvidenceNodeId: string | null;
  employeeDrawerRef: string | null;
  handoffDrawerId: string | null;
  whatIfDraft: WhatIfDraft;
  connectionMode: "sse" | "polling" | "offline" | "connecting";
  mutationTray: MutationActivity[];
  sidebarCollapsed: boolean;
  setProofLensEnabled: (v: boolean) => void;
  setSelectedOptionKey: (v: string | null) => void;
  setSelectedEvidenceNodeId: (v: string | null) => void;
  setEmployeeDrawerRef: (v: string | null) => void;
  setHandoffDrawerId: (v: string | null) => void;
  setWhatIfDraft: (v: WhatIfDraft) => void;
  setConnectionMode: (v: UiState["connectionMode"]) => void;
  setSidebarCollapsed: (v: boolean) => void;
  pushMutation: (label: string) => string;
  popMutation: (id: string) => void;
};

function persistSidebarCollapsed(v: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("tuntas.sidebarCollapsed", v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const useUiStore = create<UiState>((set) => ({
  proofLensEnabled: false,
  selectedOptionKey: null,
  selectedEvidenceNodeId: null,
  employeeDrawerRef: null,
  handoffDrawerId: null,
  whatIfDraft: {},
  connectionMode: "offline",
  mutationTray: [],
  sidebarCollapsed: false,
  setProofLensEnabled: (v) => set({ proofLensEnabled: v }),
  setSelectedOptionKey: (v) => set({ selectedOptionKey: v }),
  setSelectedEvidenceNodeId: (v) => set({ selectedEvidenceNodeId: v }),
  setEmployeeDrawerRef: (v) => set({ employeeDrawerRef: v }),
  setHandoffDrawerId: (v) => set({ handoffDrawerId: v }),
  setWhatIfDraft: (v) => set({ whatIfDraft: v }),
  setConnectionMode: (v) => set({ connectionMode: v }),
  setSidebarCollapsed: (v) => {
    persistSidebarCollapsed(v);
    set({ sidebarCollapsed: v });
  },
  pushMutation: (label) => {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({
      mutationTray: [
        ...s.mutationTray,
        { id, label, startedAt: new Date().toISOString() },
      ],
    }));
    return id;
  },
  popMutation: (id) =>
    set((s) => ({
      mutationTray: s.mutationTray.filter((m) => m.id !== id),
    })),
}));
