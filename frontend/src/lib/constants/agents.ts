export const AGENT_PIPELINE = [
  {
    id: "intake",
    label: "Intake",
    branch: "root" as const,
  },
  {
    id: "diagnostic",
    label: "Diagnostic",
    branch: "parallel" as const,
    agentNames: ["diagnostic", "capability_diagnostic", "Capability Diagnostic Agent"],
  },
  {
    id: "policy",
    label: "Policy",
    branch: "parallel" as const,
    agentNames: ["policy", "policy_compiler", "Policy Compiler Agent"],
  },
  {
    id: "vendor",
    label: "Vendor",
    branch: "parallel" as const,
    agentNames: ["vendor", "vendor_intelligence", "Vendor Intelligence Agent"],
  },
  {
    id: "learning",
    label: "Learning",
    branch: "serial" as const,
    agentNames: ["learning", "learning_architect", "Learning & Simulation Architect Agent"],
  },
  {
    id: "challenger",
    label: "Challenger",
    branch: "serial" as const,
    agentNames: ["challenger", "procurement_challenger", "Procurement & Privacy Challenger Agent"],
  },
  {
    id: "optimizer",
    label: "Optimizer",
    branch: "serial" as const,
    agentNames: ["optimizer", "portfolio_optimizer"],
  },
  {
    id: "secretariat",
    label: "Secretariat",
    branch: "serial" as const,
    agentNames: ["secretariat", "management_secretariat", "Management Secretariat Agent"],
  },
  {
    id: "hitl",
    label: "HITL",
    branch: "serial" as const,
    agentNames: ["hitl", "approval", "human_approval"],
  },
] as const;

export type AgentNodeState = "queued" | "active" | "completed" | "review" | "failed";

export const OPTION_LABELS: Record<string, string> = {
  cost: "Budget Saver",
  balanced: "Balanced",
  coverage: "Max Risk Reduction",
};

export const GOLDEN_SCENARIOS = [
  "SCN-FRAUD-MULE",
  "SCN-AML-ESC",
  "SCN-PDPA-VENDOR",
  "SCN-CS-SE",
] as const;

export const DISCLAIMER =
  "Decision support — not legal advice";

export const AICB_ATTRIBUTION =
  "Based on the Future Skills Framework developed and owned by AICB, Aii and IBFIM.";
