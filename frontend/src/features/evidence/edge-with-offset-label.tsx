"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type OffsetLabelEdge = Edge<{ edgeLabel?: string }>;

/**
 * Labels sit on the first outbound horizontal, mid-gap between ranks —
 * not under the source node, and not on the vertical smoothstep trunk.
 */
export function EdgeWithOffsetLabel({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  data,
}: EdgeProps<OffsetLabelEdge>) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const text =
    (typeof label === "string" || typeof label === "number"
      ? String(label)
      : null) ??
    (typeof data?.edgeLabel === "string" ? data.edgeLabel : null);

  // Smoothstep bends near the horizontal midpoint; stay on the source-side
  // horizontal (same Y) but clear of the node body (~12–20px past the handle).
  const dx = targetX - sourceX;
  const gap = Math.abs(dx);
  const dir = dx === 0 ? 1 : Math.sign(dx);
  // ~38% into the inter-rank channel — past the node, before the vertical trunk
  const along = dir * Math.max(18, Math.min(gap * 0.38, gap * 0.5 - 8));
  const labelX = sourceX + along;
  const labelY = sourceY - 6;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {text ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan rounded border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-px font-mono text-[9px] leading-tight text-[var(--muted-foreground)] shadow-sm"
            style={{
              position: "absolute",
              // Anchor left edge at labelX so text grows into the gap, not back under the node
              transform: `translate(0, -100%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
              // Nodes paint above default edges; raise labels above the node layer
              zIndex: 1001,
            }}
          >
            {text}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
