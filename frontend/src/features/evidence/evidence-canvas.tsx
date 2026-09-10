"use client";

import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeApiError } from "@/lib/api/errors";
import type { BlastRadiusResponse } from "@/lib/api/generated/openapi.types";
import { apiQueries } from "@/lib/api/queries";
import { DISCLAIMER } from "@/lib/constants/agents";
import { useUiStore } from "@/stores/ui-store";
import {
  aggregateParallelNodes,
  lineageFocusIds,
  type LayoutEdge,
  type LayoutNode,
} from "./aggregate-parallel";
import {
  affectedNodeIdsFromBlast,
  BlastRadiusPanel,
  greenNodeIdsFromBlast,
} from "./blast-radius-panel";
import { EdgeWithOffsetLabel } from "./edge-with-offset-label";
import { EvidenceFilterRail } from "./filter-rail";
import { EvidenceNodeInspector } from "./node-inspector";
import { toneForType } from "./type-tones";

const NODE_W = 196;
const NODE_H = 56;
/** Clear hover only after this gap — prevents A→B transit leave/enter thrash. */
const HOVER_CLEAR_MS = 140;

const evidenceEdgeTypes = {
  offsetLabel: EdgeWithOffsetLabel,
} satisfies EdgeTypes;

type BaseGraph = { nodes: Node[]; edges: Edge[] };

/**
 * Dagre + node chrome. Intentionally ignores focus so hover/pin only patches
 * opacity (avoids remounting labels / re-running layout on every mouse move).
 */
function buildBaseGraph(
  layoutNodes: LayoutNode[],
  layoutEdges: LayoutEdge[],
  affected: Set<string>,
  green: Set<string> = new Set(),
): BaseGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 20, ranksep: 160 });

  for (const n of layoutNodes) {
    const id = n.kind === "api" ? n.node.id : n.group.id;
    g.setNode(id, { width: NODE_W, height: NODE_H });
  }
  for (const e of layoutEdges) {
    g.setEdge(e.from_node_id, e.to_node_id);
  }
  dagre.layout(g);

  const rfNodes: Node[] = layoutNodes.map((ln) => {
    const id = ln.kind === "api" ? ln.node.id : ln.group.id;
    const pos = g.node(id);
    const nodeType =
      ln.kind === "api" ? ln.node.node_type : ln.group.node_type;
    const tone = toneForType(nodeType);
    const isGroup = ln.kind === "group";
    const memberAffected =
      isGroup && ln.group.memberIds.some((mid) => affected.has(mid));
    const memberGreen =
      isGroup && ln.group.memberIds.some((mid) => green.has(mid));
    const isAffected = affected.has(id) || Boolean(memberAffected);
    const isGreen = !isAffected && (green.has(id) || Boolean(memberGreen));

    const title = ln.kind === "api" ? ln.node.label : ln.group.label;
    const subtitle =
      ln.kind === "api"
        ? ln.node.node_type
        : `${ln.group.memberIds.length} stacked · click to expand`;
    // Longhands only — mixing borderWidth/borderColor with borderLeft*
    // triggers React "conflicting style property" warnings on rerender.
    const edgeWidth = isAffected || isGreen ? 2 : isGroup ? 1.5 : 1;
    const edgeColor = isAffected
      ? "var(--warning)"
      : isGreen
        ? "var(--success)"
        : isGroup
          ? "var(--border-strong)"
          : "var(--border)";

    return {
      id,
      type: "default",
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: {
        x: (pos?.x ?? 0) - NODE_W / 2,
        y: (pos?.y ?? 0) - NODE_H / 2,
      },
      data: {
        label: (
          <div className="relative px-2 py-1 text-left">
            {isGroup ? (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1 -bottom-1 h-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
                  style={{
                    transform: "translateY(3px) scale(0.97)",
                    zIndex: 0,
                  }}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0.5 -bottom-0.5 h-full rounded-[9px] border border-[var(--border)] bg-[var(--surface-emphasis)]"
                  style={{
                    transform: "translateY(1.5px) scale(0.985)",
                    zIndex: 0,
                  }}
                />
              </>
            ) : null}
            <div className="relative z-[1]">
              <div className="truncate text-xs font-semibold leading-snug text-[var(--foreground)]">
                {title}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted-foreground)]">
                {subtitle}
              </div>
            </div>
          </div>
        ),
        raw: ln.kind === "api" ? ln.node : ln.group,
        isGroup,
        isAffected,
        isGreen,
      },
      style: {
        width: NODE_W,
        height: NODE_H,
        borderTopWidth: edgeWidth,
        borderRightWidth: edgeWidth,
        borderBottomWidth: edgeWidth,
        borderLeftWidth: 4,
        borderStyle: isGroup ? "dashed" : "solid",
        borderTopColor: edgeColor,
        borderRightColor: edgeColor,
        borderBottomColor: edgeColor,
        borderLeftColor: tone.accent,
        borderRadius: 10,
        background: "var(--surface-raised)",
        fontSize: 12,
        opacity:
          (affected.size > 0 || green.size > 0) && !isAffected && !isGreen
            ? 0.32
            : 1,
        boxShadow: isAffected
          ? "0 0 0 2px color-mix(in srgb, var(--warning) 35%, transparent)"
          : isGreen
            ? "0 0 0 2px color-mix(in srgb, var(--success) 35%, transparent)"
            : isGroup
              ? "2px 3px 0 color-mix(in srgb, var(--border) 80%, transparent)"
              : "0 1px 2px rgba(20,20,19,0.04)",
        padding: 0,
        overflow: "visible",
      },
    };
  });

  const rfEdges: Edge[] = layoutEdges.map((e) => {
    const edgeHit =
      affected.has(e.from_node_id) || affected.has(e.to_node_id);
    const edgeGreen =
      !edgeHit &&
      (green.has(e.from_node_id) || green.has(e.to_node_id));
    return {
      id: e.id,
      source: e.from_node_id,
      target: e.to_node_id,
      label: e.edge_type,
      type: "offsetLabel",
      data: { edgeLabel: e.edge_type },
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: {
        stroke: edgeHit
          ? "var(--warning)"
          : edgeGreen
            ? "var(--success)"
            : "var(--border-strong)",
        strokeWidth: edgeHit || edgeGreen ? 2 : 1,
        opacity:
          (affected.size > 0 || green.size > 0) && !edgeHit && !edgeGreen
            ? 0.22
            : 1,
      },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

/** Patch opacity / highlight only — keep `data` + positions from base graph. */
function applyFocusOverlay(
  base: BaseGraph,
  focusIds: Set<string>,
  /** Flow animation only when focus is pinned (click), not hover — avoids dash restart flicker. */
  animateFocus: boolean,
): BaseGraph {
  const focusOn = focusIds.size > 0;
  if (!focusOn) return base;

  return {
    nodes: base.nodes.map((node) => {
      const inFocus = focusIds.has(node.id);
      return {
        ...node,
        // Preserve data reference so RF does not remount node internals
        data: node.data,
        style: {
          ...node.style,
          opacity: inFocus ? 1 : 0.1,
          zIndex: inFocus ? 2 : 0,
        },
      };
    }),
    edges: base.edges.map((edge) => {
      const endpointsInFocus =
        focusIds.has(edge.source) && focusIds.has(edge.target);
      return {
        ...edge,
        data: edge.data,
        animated: animateFocus && endpointsInFocus,
        style: {
          ...edge.style,
          stroke: endpointsInFocus
            ? "var(--primary)"
            : (edge.style?.stroke ?? "var(--border-strong)"),
          strokeWidth: endpointsInFocus ? 2.5 : (edge.style?.strokeWidth ?? 1),
          opacity: endpointsInFocus ? 1 : 0.08,
        },
      };
    }),
  };
}

function EvidenceCanvasInner({
  runId,
  framework: frameworkProp,
  autoBlast: autoBlastProp,
}: {
  runId: string;
  framework?: string | null;
  autoBlast?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nodeParam = searchParams.get("node");
  const modeParam = searchParams.get("mode");
  const frameworkParam =
    frameworkProp || searchParams.get("framework") || "BNM_ORTC_2026";
  const autoBlast =
    autoBlastProp ?? searchParams.get("blast") === "1";
  const setSelectedEvidenceNodeId = useUiStore(
    (s) => s.setSelectedEvidenceNodeId,
  );
  const { setCenter, getNode, fitView } = useReactFlow();

  const graphQuery = useQuery(apiQueries.evidenceGraph(runId));
  const [typeFilter, setTypeFilter] = useState<Set<string> | null>(null);
  const [blastPreview, setBlastPreview] = useState<BlastRadiusResponse | null>(
    null,
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoverFocusId, setHoverFocusId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [graphFocus, setGraphFocus] = useState(false);
  const hoverClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didFitRef = useRef(false);
  /** Pan after expand-group layout settles. */
  const pendingPanId = useRef<string | null>(null);
  /** After Assess: fit camera to blast-affected nodes once RF styles settle. */
  const pendingBlastFit = useRef(false);

  const apiNodes = useMemo(
    () => graphQuery.data?.nodes ?? [],
    [graphQuery.data?.nodes],
  );
  const apiEdges = useMemo(
    () => graphQuery.data?.edges ?? [],
    [graphQuery.data?.edges],
  );

  const allTypes = useMemo(() => {
    const s = new Set(apiNodes.map((n) => n.node_type));
    return [...s].sort();
  }, [apiNodes]);

  const selectedTypes = useMemo(
    () => typeFilter ?? new Set(allTypes),
    [typeFilter, allTypes],
  );

  const affected = useMemo(
    () => affectedNodeIdsFromBlast(blastPreview),
    [blastPreview],
  );
  const greenIds = useMemo(
    () => greenNodeIdsFromBlast(blastPreview, apiNodes),
    [blastPreview, apiNodes],
  );

  const filteredApiNodes = useMemo(
    () => apiNodes.filter((n) => selectedTypes.has(n.node_type)),
    [apiNodes, selectedTypes],
  );
  const filteredApiIds = useMemo(
    () => new Set(filteredApiNodes.map((n) => n.id)),
    [filteredApiNodes],
  );
  const filteredApiEdges = useMemo(
    () =>
      apiEdges.filter(
        (e) =>
          filteredApiIds.has(e.from_node_id) &&
          filteredApiIds.has(e.to_node_id),
      ),
    [apiEdges, filteredApiIds],
  );

  const { layoutNodes, layoutEdges, groups } = useMemo(
    () =>
      aggregateParallelNodes(
        filteredApiNodes,
        filteredApiEdges,
        expandedGroups,
      ),
    [filteredApiNodes, filteredApiEdges, expandedGroups],
  );

  const stickyFocusId = useMemo(() => {
    if (hoverFocusId) return hoverFocusId;
    if (nodeParam && filteredApiIds.has(nodeParam)) return nodeParam;
    return null;
  }, [hoverFocusId, nodeParam, filteredApiIds]);

  const focusIds = useMemo(() => {
    if (!stickyFocusId) return new Set<string>();
    const base = lineageFocusIds(stickyFocusId, layoutEdges);
    for (const g of groups) {
      if (expandedGroups.has(g.id)) continue;
      if (
        g.memberIds.includes(stickyFocusId) ||
        base.has(g.anchorId) ||
        g.memberIds.some((id) => base.has(id))
      ) {
        base.add(g.id);
        base.add(g.anchorId);
      }
    }
    return base;
  }, [stickyFocusId, layoutEdges, groups, expandedGroups]);

  const baseGraph = useMemo(
    () => buildBaseGraph(layoutNodes, layoutEdges, affected, greenIds),
    [layoutNodes, layoutEdges, affected, greenIds],
  );

  // Animate only for click-pinned focus (not hover) to avoid dash-array restart flicker
  const animateFocus = Boolean(
    nodeParam && stickyFocusId === nodeParam && !hoverFocusId,
  );

  const { nodes, edges } = useMemo(
    () => applyFocusOverlay(baseGraph, focusIds, animateFocus),
    [baseGraph, focusIds, animateFocus],
  );

  const selectedNode = useMemo(() => {
    if (!nodeParam) return null;
    return apiNodes.find((n) => n.id === nodeParam) ?? null;
  }, [apiNodes, nodeParam]);

  useEffect(() => {
    return () => {
      if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    };
  }, []);

  const panToNode = useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return false;
      const x = node.position.x + NODE_W / 2;
      const y = node.position.y + NODE_H / 2;
      void setCenter(x, y, { zoom: 1.2, duration: 800 });
      return true;
    },
    [getNode, setCenter],
  );

  // After expanding a stack, wait for RF nodes to include the member then pan
  useEffect(() => {
    const id = pendingPanId.current;
    if (!id) return;
    if (!nodes.some((n) => n.id === id)) return;
    pendingPanId.current = null;
    // Next frame so positions are committed
    const raf = requestAnimationFrame(() => {
      panToNode(id);
    });
    return () => cancelAnimationFrame(raf);
  }, [nodes, panToNode]);

  // After Assess: release click-focus overlay, then frame affected nodes
  useEffect(() => {
    if (!pendingBlastFit.current) return;
    if (affected.size === 0) {
      pendingBlastFit.current = false;
      return;
    }
    const hit = nodes.filter((n) => {
      const data = n.data as
        | { isAffected?: boolean; isGreen?: boolean }
        | undefined;
      return Boolean(data?.isAffected || data?.isGreen);
    });
    if (hit.length === 0) return;
    pendingBlastFit.current = false;
    const raf = requestAnimationFrame(() => {
      void fitView({
        nodes: hit,
        padding: 0.22,
        duration: 650,
        maxZoom: 1.35,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [nodes, affected, fitView]);

  const updateUrl = useCallback(
    (nodeId: string | null, mode: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nodeId) params.set("node", nodeId);
      else params.delete("node");
      if (mode) params.set("mode", mode);
      else params.delete("mode");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleBlastImpact = useCallback(
    (response: BlastRadiusResponse | null) => {
      setBlastPreview(response);
      // Drop pinned click/lineage focus — otherwise inspector + focus overlay
      // stay on the previously clicked node and hide the Assess result.
      if (hoverClearTimer.current) {
        clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      setHoverFocusId(null);
      setSelectedEvidenceNodeId(null);
      // Do not router.replace on auto-assess — rewriting the query can drop
      // blast=1 on first paint and remount the canvas with empty preview.
      if (searchParams.get("node") || searchParams.get("mode")) {
        updateUrl(null, null);
      }
      pendingBlastFit.current = Boolean(
        response && affectedNodeIdsFromBlast(response).size > 0,
      );
    },
    [setSelectedEvidenceNodeId, updateUrl, searchParams],
  );

  useEffect(() => {
    if (!blastPreview || apiNodes.length === 0) return;
    const featured = blastPreview.featured_red as
      | { employee_ref?: string; course_code?: string }
      | undefined;
    const featuredG = blastPreview.featured_green as
      | { employee_ref?: string; course_code?: string }
      | undefined;
    const refs = new Set(
      [
        featured?.employee_ref,
        featured?.course_code,
        featuredG?.employee_ref,
        featuredG?.course_code,
      ].filter(Boolean) as string[],
    );
    const featuredIds = new Set(
      apiNodes.filter((n) => refs.has(n.external_ref)).map((n) => n.id),
    );
    const affectedIds = affectedNodeIdsFromBlast(blastPreview);
    const greenFromBlast = greenNodeIdsFromBlast(blastPreview, apiNodes);
    setExpandedGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const g of groups) {
        const hit = g.memberIds.some(
          (id) =>
            featuredIds.has(id) ||
            affectedIds.has(id) ||
            greenFromBlast.has(id),
        );
        if (!next.has(g.id) && hit) {
          next.add(g.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [blastPreview, apiNodes, groups]);

  const focusOnNode = useCallback(
    (nodeId: string) => {
      // Ensure type filter shows this node
      const apiNode = apiNodes.find((n) => n.id === nodeId);
      if (apiNode && typeFilter && !typeFilter.has(apiNode.node_type)) {
        setTypeFilter((prev) => {
          const next = new Set(prev ?? allTypes);
          next.add(apiNode.node_type);
          return next;
        });
      }

      const collapsed = groups.find(
        (g) => !expandedGroups.has(g.id) && g.memberIds.includes(nodeId),
      );
      if (collapsed) {
        pendingPanId.current = nodeId;
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          next.add(collapsed.id);
          return next;
        });
      } else {
        // Slight delay so selection/focus overlay can settle
        requestAnimationFrame(() => {
          if (!panToNode(nodeId)) {
            pendingPanId.current = nodeId;
          }
        });
      }

      if (hoverClearTimer.current) {
        clearTimeout(hoverClearTimer.current);
        hoverClearTimer.current = null;
      }
      setHoverFocusId(null);
      setSelectedEvidenceNodeId(nodeId);
      updateUrl(nodeId, modeParam);
      setSearchQuery("");
    },
    [
      apiNodes,
      typeFilter,
      allTypes,
      groups,
      expandedGroups,
      panToNode,
      setSelectedEvidenceNodeId,
      updateUrl,
      modeParam,
    ],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      if (node.data?.isGroup) {
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      setSelectedEvidenceNodeId(node.id);
      updateUrl(node.id, modeParam);
    },
    [modeParam, setSelectedEvidenceNodeId, updateUrl],
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_evt, node) => {
    if (hoverClearTimer.current) {
      clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    setHoverFocusId(node.id);
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    if (hoverClearTimer.current) clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = setTimeout(() => {
      setHoverFocusId(null);
      hoverClearTimer.current = null;
    }, HOVER_CLEAR_MS);
  }, []);

  const onPaneClick = useCallback(() => {
    if (hoverClearTimer.current) {
      clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    setHoverFocusId(null);
  }, []);

  function toggleType(type: string) {
    setTypeFilter((prev) => {
      const base = prev ?? new Set(allTypes);
      const next = new Set(base);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const toggleGraphFocus = useCallback(() => {
    setGraphFocus((prev) => {
      const next = !prev;
      // Refit after panels hide/show so the graph fills the rectangle.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void fitView({ padding: next ? 0.1 : 0.15, duration: 280 });
        });
      });
      return next;
    });
  }, [fitView]);

  useEffect(() => {
    if (!graphFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setGraphFocus(false);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            void fitView({ padding: 0.15, duration: 280 });
          });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graphFocus, fitView]);

  const collapsedCount = groups
    .filter((g) => !expandedGroups.has(g.id))
    .reduce((sum, g) => sum + g.memberIds.length - 1, 0);

  if (graphQuery.isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center p-6">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    );
  }

  if (graphQuery.isError) {
    const err = normalizeApiError(graphQuery.error);
    return (
      <div className="p-6">
        <ErrorState
          message={err.message}
          status={err.status}
          endpoint={`/v1/runs/${runId}/evidence-graph`}
          onRetry={() => void graphQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-[var(--background)]">
      <div className="absolute inset-0 z-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={evidenceEdgeTypes}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onPaneClick={onPaneClick}
          onInit={(instance) => {
            if (didFitRef.current) return;
            didFitRef.current = true;
            void instance.fitView({ padding: 0.15 });
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--border)" />
          <Controls className="!bottom-4 !left-4" />
        </ReactFlow>
        {apiNodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-raised)]/90 px-4 py-3 text-sm text-[var(--muted-foreground)] backdrop-blur-sm">
              Evidence graph is empty — no nodes from API.
            </p>
          </div>
        ) : null}
      </div>

      {graphFocus ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
          <div className="pointer-events-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/90 px-3 py-2 shadow-sm backdrop-blur-md">
            <p className="text-xs font-medium text-[var(--foreground)]">
              Graph focus
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Side panels hidden · Esc or restore to exit
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="pointer-events-auto h-9 gap-1.5 bg-[var(--surface-raised)]/95 shadow-sm backdrop-blur-md"
            onClick={toggleGraphFocus}
            aria-pressed
            aria-label="Restore Evidence Spine panels"
            title="Restore panels"
          >
            <Minimize2 className="size-3.5" aria-hidden />
            Restore
          </Button>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute bottom-28 left-4 top-4 z-10 flex w-[min(100%-2rem,22rem)] flex-col gap-3">
            <header className="pointer-events-auto shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/85 p-4 shadow-sm backdrop-blur-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="font-display text-xl tracking-tight text-[var(--foreground)]">
                    Evidence Spine
                  </h1>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {DISCLAIMER}
                  </p>
                  {collapsedCount > 0 ? (
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                      {collapsedCount} nodes stacked in groups · hover for focus
                      mode
                    </p>
                  ) : (
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted-foreground)]">
                      Hover a node for focus mode · click to pin
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 gap-1.5 px-2.5"
                  onClick={toggleGraphFocus}
                  aria-pressed={false}
                  aria-label="Expand graph to focus rectangle"
                  title="Focus graph"
                >
                  <Maximize2 className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">Focus</span>
                </Button>
              </div>
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <BlastRadiusPanel
                  runId={runId}
                  onImpact={handleBlastImpact}
                  initialFramework={frameworkParam || "BNM_ORTC_2026"}
                  autoAssess={autoBlast}
                  graphReady={graphQuery.isSuccess && apiNodes.length > 0}
                />
              </div>
            </header>

            <EvidenceFilterRail
              className="pointer-events-auto min-h-0 w-full flex-1"
              nodeTypes={allTypes}
              selectedTypes={selectedTypes}
              onToggleType={toggleType}
              onSelectAll={() => setTypeFilter(null)}
              onClear={() => setTypeFilter(new Set())}
              nodeCount={apiNodes.length}
              edgeCount={apiEdges.length}
              searchNodes={apiNodes}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onSearchSelect={focusOnNode}
            />
          </div>

          <EvidenceNodeInspector
            className="absolute bottom-4 right-4 top-4 z-10 max-h-[calc(100%-2rem)]"
            runId={runId}
            node={selectedNode}
            mode={modeParam}
            onToggleLineage={() => {
              if (!selectedNode) return;
              updateUrl(
                selectedNode.id,
                modeParam === "lineage" ? null : "lineage",
              );
            }}
          />
        </>
      )}
    </div>
  );
}

export function EvidenceCanvas({
  runId,
  framework,
  autoBlast,
}: {
  runId: string;
  framework?: string | null;
  autoBlast?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <EvidenceCanvasInner
        runId={runId}
        framework={framework}
        autoBlast={autoBlast}
      />
    </ReactFlowProvider>
  );
}
