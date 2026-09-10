import { AGENT_PIPELINE } from "@/lib/constants/agents";
import type { AgentHandoffView } from "@/lib/api/generated/openapi.types";

export function findHandoff(
  handoffs: AgentHandoffView[],
  pipelineId: (typeof AGENT_PIPELINE)[number]["id"],
) {
  const entry = AGENT_PIPELINE.find((a) => a.id === pipelineId);
  const names = entry && "agentNames" in entry ? entry.agentNames : [];
  const nset = names.map((n) => n.toLowerCase());
  return (
    handoffs.find((h) => {
      const n = h.agent_name.toLowerCase();
      return nset.some((name) => n.includes(name));
    }) ?? null
  );
}
