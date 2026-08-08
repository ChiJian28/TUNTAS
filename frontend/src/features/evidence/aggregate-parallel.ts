/**
 * Collapse parallel same-type leaves that all wire to the same neighbour.
 * Pure UI aggregation — does not invent API nodes/edges.
 */

import type {
  EvidenceEdgeView,
  EvidenceNodeView,
} from "@/lib/api/generated/openapi.types";

/** Collapse only when at least this many siblings share the same fan-in/out. */
export const AGGREGATE_MIN = 4;

export type AggregateGroup = {
  id: string;
  node_type: string;
  label: string;
  memberIds: string[];
  /** Neighbour the members share (single hop). */
  anchorId: string;
  /** Direction relative to the group node. */
  direction: "out" | "in";
  edge_type: string;
  /** Representative API edge ids (one per member). */
  memberEdgeIds: string[];
};

export type LayoutNode =
  | { kind: "api"; node: EvidenceNodeView }
  | { kind: "group"; group: AggregateGroup };

export type LayoutEdge = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  /** Underlying API edge id(s) for blast / focus. */
  apiEdgeIds: string[];
};

function degreeMaps(edges: EvidenceEdgeView[]) {
  const out = new Map<string, EvidenceEdgeView[]>();
  const inn = new Map<string, EvidenceEdgeView[]>();
  for (const e of edges) {
    if (!out.has(e.from_node_id)) out.set(e.from_node_id, []);
    if (!inn.has(e.to_node_id)) inn.set(e.to_node_id, []);
    out.get(e.from_node_id)!.push(e);
    inn.get(e.to_node_id)!.push(e);
  }
  return { out, inn };
}

function humanType(nodeType: string): string {
  return nodeType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Group A: many nodes of same type, each with exactly one outgoing edge to the
 * same target (and no other edges) → collapse into one "stack" source.
 * Group B: same pattern for single-incoming sinks.
 */
export function aggregateParallelNodes(
  nodes: EvidenceNodeView[],
  edges: EvidenceEdgeView[],
  expandedGroupIds: Set<string>,
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[]; groups: AggregateGroup[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { out, inn } = degreeMaps(edges);

  const groups: AggregateGroup[] = [];
  const groupedMemberIds = new Set<string>();
  const consumedEdgeIds = new Set<string>();

  type Bucket = {
    nodeType: string;
    anchorId: string;
    edgeType: string;
    direction: "out" | "in";
    members: EvidenceNodeView[];
    edges: EvidenceEdgeView[];
  };
  const buckets = new Map<string, Bucket>();

  for (const n of nodes) {
    const outs = out.get(n.id) ?? [];
    const inns = inn.get(n.id) ?? [];

    // Fan-out leaves → single target
    if (outs.length === 1 && inns.length === 0) {
      const e = outs[0]!;
      const key = `out|${n.node_type}|${e.to_node_id}|${e.edge_type}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          nodeType: n.node_type,
          anchorId: e.to_node_id,
          edgeType: e.edge_type,
          direction: "out",
          members: [],
          edges: [],
        };
        buckets.set(key, b);
      }
      b.members.push(n);
      b.edges.push(e);
      continue;
    }

    // Fan-in leaves ← single source
    if (inns.length === 1 && outs.length === 0) {
      const e = inns[0]!;
      const key = `in|${n.node_type}|${e.from_node_id}|${e.edge_type}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          nodeType: n.node_type,
          anchorId: e.from_node_id,
          edgeType: e.edge_type,
          direction: "in",
          members: [],
          edges: [],
        };
        buckets.set(key, b);
      }
      b.members.push(n);
      b.edges.push(e);
    }
  }

  for (const [key, b] of buckets) {
    if (b.members.length < AGGREGATE_MIN) continue;
    // Anchor must still exist in the filtered node set
    if (!byId.has(b.anchorId)) continue;

    const id = `group:${key}`;
    const group: AggregateGroup = {
      id,
      node_type: b.nodeType,
      label: `${humanType(b.nodeType)} (${b.members.length})`,
      memberIds: b.members.map((m) => m.id),
      anchorId: b.anchorId,
      direction: b.direction,
      edge_type: b.edgeType,
      memberEdgeIds: b.edges.map((e) => e.id),
    };
    groups.push(group);

    if (expandedGroupIds.has(id)) continue;

    for (const m of b.members) groupedMemberIds.add(m.id);
    for (const e of b.edges) consumedEdgeIds.add(e.id);
  }

  const layoutNodes: LayoutNode[] = [];
  for (const n of nodes) {
    if (groupedMemberIds.has(n.id)) continue;
    layoutNodes.push({ kind: "api", node: n });
  }
  for (const g of groups) {
    if (expandedGroupIds.has(g.id)) continue;
    layoutNodes.push({ kind: "group", group: g });
  }

  const layoutEdges: LayoutEdge[] = [];
  for (const e of edges) {
    if (consumedEdgeIds.has(e.id)) continue;
    layoutEdges.push({
      id: e.id,
      from_node_id: e.from_node_id,
      to_node_id: e.to_node_id,
      edge_type: e.edge_type,
      apiEdgeIds: [e.id],
    });
  }
  for (const g of groups) {
    if (expandedGroupIds.has(g.id)) continue;
    layoutEdges.push({
      id: `${g.id}::wire`,
      from_node_id: g.direction === "out" ? g.id : g.anchorId,
      to_node_id: g.direction === "out" ? g.anchorId : g.id,
      edge_type: g.edge_type,
      apiEdgeIds: g.memberEdgeIds,
    });
  }

  return { layoutNodes, layoutEdges, groups };
}

/** Directed ancestors + descendants of `focusId` in the layout graph. */
export function lineageFocusIds(
  focusId: string,
  edges: LayoutEdge[],
): Set<string> {
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (!outAdj.has(e.from_node_id)) outAdj.set(e.from_node_id, []);
    if (!inAdj.has(e.to_node_id)) inAdj.set(e.to_node_id, []);
    outAdj.get(e.from_node_id)!.push(e.to_node_id);
    inAdj.get(e.to_node_id)!.push(e.from_node_id);
  }

  const focus = new Set<string>([focusId]);

  const walk = (start: string, adj: Map<string, string[]>) => {
    const stack = [start];
    const seen = new Set<string>([start]);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        focus.add(nxt);
        stack.push(nxt);
      }
    }
  };

  walk(focusId, outAdj);
  walk(focusId, inAdj);
  return focus;
}
