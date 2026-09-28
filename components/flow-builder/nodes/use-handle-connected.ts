import { useNodeId, useStore } from "@xyflow/react";

/**
 * True when this node has an outgoing edge from the given source handle
 * (or, for `handleId` undefined, the node's default/bottom handle — i.e.
 * an edge with no `sourceHandle` at all). Purely a canvas read: no writes,
 * so it's safe to call from any node component without touching
 * flow-canvas.tsx.
 *
 * Used to give each button/quick-reply/branch connector its own "wired" vs
 * "not wired yet" look, the way ManyChat highlights a connected dot.
 */
export function useHandleConnected(handleId?: string): boolean {
  const nodeId = useNodeId();
  return useStore((s) =>
    s.edges.some(
      (e) => e.source === nodeId && (e.sourceHandle ?? undefined) === handleId
    )
  );
}
