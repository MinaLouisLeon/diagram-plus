import { useCallback, useMemo, useRef, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BLOCK_CATALOG,
  EDGE_TYPE_INFO,
  defaultSizeFor,
  type BatchOperation,
  type BlockType,
  type Diagram,
} from '@diagram-plus/core/browser';
import { BlockNode, type BlockFlowNode } from './BlockNode';
import { store, useEditorState } from '../store';

/**
 * The canvas.
 *
 * React Flow owns the interaction (pan, zoom, drag, connect); everything it
 * reports is translated into the same batch operations the MCP tools use, so
 * the file on disk is updated the same way either edit arrives.
 */

const nodeTypes = { block: BlockNode };

function toNodes(diagram: Diagram, selected: string[]): BlockFlowNode[] {
  const selection = new Set(selected);
  return diagram.blocks.map((block) => ({
    id: block.id,
    type: 'block' as const,
    position: block.position,
    selected: selection.has(block.id),
    width: block.size.width,
    height: block.size.height,
    data: { block },
    style: { width: block.size.width, height: block.size.height },
  }));
}

function toEdges(diagram: Diagram, selected: string[]): FlowEdge[] {
  const selection = new Set(selected);
  return diagram.edges.map((edge) => {
    const info = EDGE_TYPE_INFO[edge.type];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.condition || edge.label || info.label,
      selected: selection.has(edge.id),
      animated: edge.type === 'data_flow' || edge.type === 'emits',
      style: {
        strokeDasharray:
          info.style === 'dashed' ? '6 4' : info.style === 'dotted' ? '2 4' : undefined,
        stroke: edge.type === 'error_flow' ? 'var(--danger)' : undefined,
      },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
    };
  });
}

function CanvasInner() {
  const { current, selectedBlocks, selectedEdges } = useEditorState();
  const wrapper = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  /** Positions captured while a drag is in progress, committed on drag stop. */
  const dragging = useRef(new Map<string, { x: number; y: number }>());

  const nodes = useMemo(
    () => (current ? toNodes(current, selectedBlocks) : []),
    [current, selectedBlocks],
  );
  const edges = useMemo(
    () => (current ? toEdges(current, selectedEdges) : []),
    [current, selectedEdges],
  );

  const onNodesChange = useCallback((changes: NodeChange<BlockFlowNode>[]) => {
    const moves: BatchOperation[] = [];

    // React Flow is controlled here, so selection only sticks if we apply it.
    const selectChanges = changes.filter(
      (change): change is NodeChange<BlockFlowNode> & { type: 'select'; id: string; selected: boolean } =>
        change.type === 'select',
    );
    if (selectChanges.length) {
      const next = new Set(store.getState().selectedBlocks);
      for (const change of selectChanges) {
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      store.select([...next], next.size ? [] : store.getState().selectedEdges);
    }

    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        dragging.current.set(change.id, change.position);
        if (change.dragging === false) {
          moves.push({
            op: 'move_block',
            block: change.id,
            x: Math.round(change.position.x),
            y: Math.round(change.position.y),
          });
        }
      }
      if (change.type === 'dimensions' && change.dimensions && change.resizing === false) {
        moves.push({
          op: 'update_block',
          block: change.id,
          patch: {
            size: {
              width: Math.round(change.dimensions.width),
              height: Math.round(change.dimensions.height),
            },
          },
        });
      }
      if (change.type === 'remove') {
        moves.push({ op: 'delete_block', block: change.id });
      }
    }
    if (moves.length) {
      dragging.current.clear();
      store.apply(moves);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const selectChanges = changes.filter(
      (change): change is EdgeChange<FlowEdge> & { type: 'select'; id: string; selected: boolean } =>
        change.type === 'select',
    );
    if (selectChanges.length) {
      const next = new Set(store.getState().selectedEdges);
      for (const change of selectChanges) {
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      store.select(next.size ? [] : store.getState().selectedBlocks, [...next]);
    }

    const removals = changes
      .filter((change): change is EdgeChange<FlowEdge> & { type: 'remove'; id: string } =>
        change.type === 'remove',
      )
      .map((change): BatchOperation => ({ op: 'delete_edge', edge: change.id }));
    if (removals.length) store.apply(removals);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !current) return;
      const source = current.blocks.find((b) => b.id === connection.source);
      const target = current.blocks.find((b) => b.id === connection.target);
      store.apply([
        {
          op: 'add_edge',
          edge: {
            source: connection.source,
            target: connection.target,
            type: suggestEdgeType(source?.type, target?.type),
          },
        },
      ]);
    },
    [current],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/diagram-plus-block') as BlockType;
      if (!type || !BLOCK_CATALOG[type]) return;
      const size = defaultSizeFor(type);
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      store.apply([
        {
          op: 'add_block',
          block: {
            type,
            name: BLOCK_CATALOG[type].defaultName,
            position: {
              x: Math.round(point.x - size.width / 2),
              y: Math.round(point.y - size.height / 2),
            },
          },
        },
      ]);
    },
    [flow],
  );

  const hasSavedViewport =
    current !== null && (current.canvas.x !== 0 || current.canvas.y !== 0 || current.canvas.zoom !== 1);

  if (!current) return null;

  return (
    <div ref={wrapper} style={{ flex: 1, minHeight: 0 }} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultViewport={current.canvas}
        fitView={!hasSavedViewport && current.blocks.length > 0}
        onMoveEnd={(_, viewport) => store.saveViewport(viewport)}
        minZoom={0.15}
        maxZoom={2.5}
        selectionOnDrag
        panOnScroll
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const block = (node.data as { block?: { type: BlockType; color: string } }).block;
            return block ? block.color || BLOCK_CATALOG[block.type].color : 'var(--border)';
          }}
          maskColor="rgb(0 0 0 / 0.35)"
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            width: 190,
            height: 126,
          }}
        />
      </ReactFlow>
    </div>
  );
}

/** Pick the relationship a user most likely means for this pair of blocks. */
export function suggestEdgeType(
  source: BlockType | undefined,
  target: BlockType | undefined,
): 'calls' | 'reads' | 'renders' | 'navigation' | 'emits' | 'listens' | 'depends_on' {
  if (!source || !target) return 'calls';
  if (target === 'data_model' || target === 'datastore') return 'reads';
  if (target === 'event') return 'emits';
  if (source === 'event') return 'listens';
  if (target === 'ui_component' && (source === 'ui_screen' || source === 'ui_component')) {
    return 'renders';
  }
  if (target === 'ui_screen') return 'navigation';
  if (source === 'config' || target === 'config') return 'depends_on';
  return 'calls';
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
