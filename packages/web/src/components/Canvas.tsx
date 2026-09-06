import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  applyNodeChanges,
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
import { separator, showContextMenu } from '../context-menu';
import { addBlockSubmenu, blockMenu, edgeMenu } from '../menus';
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
  const { current, selectedBlocks, selectedEdges, catalog } = useEditorState();
  const wrapper = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  /** True between the first and last frame of a drag or resize gesture. */
  const gesturing = useRef(false);

  /**
   * React Flow drives the nodes during a gesture and the store owns them the
   * rest of the time.
   *
   * The store is only told where a block ended up, once, on drag stop — one
   * operation and one write per move rather than one per frame. But that means
   * the store cannot be the source of truth *while* the pointer is down, or
   * the block would sit still until the gesture finished and then jump.
   */
  const [nodes, setNodes] = useState<BlockFlowNode[]>(() =>
    current ? toNodes(current, selectedBlocks) : [],
  );

  useEffect(() => {
    // Mid-gesture, React Flow's copy is ahead of the store's; leave it alone.
    if (gesturing.current) return;
    setNodes(current ? toNodes(current, selectedBlocks) : []);
  }, [current, selectedBlocks]);

  const edges = useMemo(
    () => (current ? toEdges(current, selectedEdges) : []),
    [current, selectedEdges],
  );

  const onNodesChange = useCallback((changes: NodeChange<BlockFlowNode>[]) => {
    // Always apply first, so every frame of a drag or resize is drawn.
    setNodes((previous) => applyNodeChanges(changes, previous));

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
        if (change.dragging) {
          gesturing.current = true;
        } else {
          moves.push({
            op: 'move_block',
            block: change.id,
            x: Math.round(change.position.x),
            y: Math.round(change.position.y),
          });
        }
      }
      if (change.type === 'dimensions' && change.dimensions) {
        if (change.resizing) {
          gesturing.current = true;
        } else if (change.resizing === false) {
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
      }
      if (change.type === 'remove') {
        moves.push({ op: 'delete_block', block: change.id });
      }
    }
    if (moves.length) {
      gesturing.current = false;
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

  /** Drop a new block of `type` centered on a point in screen coordinates. */
  const addBlockAt = useCallback(
    (type: BlockType, screen: { x: number; y: number }) => {
      const size = defaultSizeFor(type);
      const point = flow.screenToFlowPosition(screen);
      return store.apply([
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

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/diagram-plus-block') as BlockType;
      if (!type || !BLOCK_CATALOG[type]) return;
      addBlockAt(type, { x: event.clientX, y: event.clientY });
    },
    [addBlockAt],
  );

  /* ---- context menus ---------------------------------------------------- */

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      // A node or an edge under the pointer has already answered this click:
      // the pane sees the same event on its way up.
      if (event.defaultPrevented || !current) return;
      const at = { x: event.clientX, y: event.clientY };
      const blockIds = current.blocks.map((block) => block.id);

      showContextMenu(event, [
        {
          label: 'Add block',
          items: addBlockSubmenu(catalog, (type) => {
            const added = addBlockAt(type, at)?.createdBlocks[0];
            if (added) store.select([added.id]);
          }),
        },
        separator,
        {
          label: 'Select all blocks',
          disabled: !blockIds.length,
          onSelect: () => store.select(blockIds),
        },
        {
          label: 'Clear selection',
          disabled: !selectedBlocks.length && !selectedEdges.length,
          onSelect: () => store.select([], []),
        },
        separator,
        {
          label: 'Tidy up',
          disabled: !blockIds.length,
          onSelect: () => store.runLayout('LR'),
        },
        {
          label: 'Fit view',
          disabled: !blockIds.length,
          onSelect: () => void flow.fitView({ padding: 0.25, maxZoom: 1 }),
        },
        { label: 'Reset zoom', onSelect: () => void flow.zoomTo(1) },
      ]);
    },
    [addBlockAt, catalog, current, flow, selectedBlocks, selectedEdges],
  );

  /** Right-clicking outside the selection moves it, the way editors do. */
  const menuTargets = useCallback((id: string): string[] => {
    const selected = store.getState().selectedBlocks;
    if (selected.includes(id) && selected.length > 1) return selected;
    store.select([id]);
    return [id];
  }, []);

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: BlockFlowNode) => {
      if (!current) return;
      const ids = menuTargets(node.id);
      showContextMenu(
        event,
        blockMenu(current, ids, {
          onCanvas: true,
          onCenter: () =>
            void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, maxZoom: 1.2 }),
        }),
      );
    },
    [current, flow, menuTargets],
  );

  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent, selection: BlockFlowNode[]) => {
      if (!current) return;
      const ids = selection.map((node) => node.id);
      store.select(ids);
      showContextMenu(
        event,
        blockMenu(current, ids, {
          onCanvas: true,
          onCenter: () =>
            void flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, maxZoom: 1.2 }),
        }),
      );
    },
    [current, flow],
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, flowEdge: FlowEdge) => {
      const edge = current?.edges.find((candidate) => candidate.id === flowEdge.id);
      if (!current || !edge) return;
      store.select([], [edge.id]);
      showContextMenu(event, edgeMenu(current, edge));
    },
    [current],
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
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        // A safety net: if a gesture ends without a final position change —
        // a cancelled drag, a pointer lost outside the window — the flag has
        // to clear anyway, or the canvas would stop taking updates from disk.
        onNodeDragStop={() => {
          gesturing.current = false;
        }}
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
