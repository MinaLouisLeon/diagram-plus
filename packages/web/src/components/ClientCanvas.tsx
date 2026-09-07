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
import {
  BLOCK_CATALOG,
  type ClientEdge,
  type ClientNode as ClientNodeModel,
  type ClientView,
  type ClientViewOperation,
} from '@diagram-plus/core/browser';
import { ClientNode, type ClientFlowNode } from './ClientNode';
import { separator, showContextMenu } from '../context-menu';
import { addBlockSubmenu } from '../menus';
import { store, useEditorState } from '../store';

/**
 * The client canvas.
 *
 * The same machinery as the technical canvas — React Flow, drag to move, drag
 * from an edge to connect — pointed at the other document. Everything it
 * reports becomes a client view operation, which is the same vocabulary the
 * MCP tools use, so an arrow drawn in a meeting and an arrow drawn by Claude
 * are the same kind of change.
 */

const nodeTypes = { client: ClientNode };

function toNodes(view: ClientView, selected: string[], presenting: boolean): ClientFlowNode[] {
  const selection = new Set(selected);
  return view.nodes.map((node) => ({
    id: node.id,
    type: 'client' as const,
    position: node.position,
    selected: selection.has(node.id),
    draggable: !presenting,
    connectable: !presenting,
    data: { node, presenting },
  }));
}

function toEdges(view: ClientView): FlowEdge[] {
  // One step can lead to several places at once — "Place the order" reaches
  // both the payment service and the decision. Saying it on every arrow puts
  // the same words on top of each other, so it is said once and the rest of
  // the fan-out is left plain. Conditions are never suppressed: they are the
  // branching, and the reader needs every one of them.
  const said = new Set<string>();
  return view.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edgeLabel(edge, said),
    animated: false,
    className: edge.origin === 'client' ? 'client-edge fresh' : 'client-edge',
    style: {
      stroke: edge.type === 'error_flow' ? 'var(--danger)' : undefined,
      strokeDasharray: edge.origin === 'client' ? '6 4' : undefined,
    },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 4,
  }));
}

/** What the arrow says out loud. Conditions win: they are the branching. */
function edgeLabel(edge: ClientEdge, said: Set<string>): string {
  if (edge.condition) return `If ${edge.condition}`;
  if (!edge.label) return '';
  const key = `${edge.source}|${edge.label}`;
  if (said.has(key)) return '';
  said.add(key);
  return edge.label;
}

interface ClientCanvasProps {
  view: ClientView;
  /** Presentation mode: read-only, no chrome, bigger. */
  presenting?: boolean;
}

function ClientCanvasInner({ view, presenting = false }: ClientCanvasProps) {
  const { selectedClient, catalog, current } = useEditorState();
  const flow = useReactFlow();
  const gesturing = useRef(false);

  const [nodes, setNodes] = useState<ClientFlowNode[]>(() =>
    toNodes(view, selectedClient, presenting),
  );

  useEffect(() => {
    if (gesturing.current) return;
    setNodes(toNodes(view, selectedClient, presenting));
  }, [view, selectedClient, presenting]);

  const edges = useMemo(() => toEdges(view), [view]);

  const edit = useCallback((operations: ClientViewOperation[]) => {
    store.clientEdit(operations);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<ClientFlowNode>[]) => {
      setNodes((previous) => applyNodeChanges(changes, previous));
      if (presenting) return;

      const selectChanges = changes.filter(
        (change): change is NodeChange<ClientFlowNode> & { type: 'select'; id: string; selected: boolean } =>
          change.type === 'select',
      );
      if (selectChanges.length) {
        const next = new Set(store.getState().selectedClient);
        for (const change of selectChanges) {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
        store.selectClient([...next]);
      }

      const operations: ClientViewOperation[] = [];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          if (change.dragging) {
            gesturing.current = true;
          } else {
            operations.push({
              op: 'move_node',
              node: change.id,
              x: Math.round(change.position.x),
              y: Math.round(change.position.y),
            });
          }
        }
        if (change.type === 'remove') {
          operations.push({ op: 'remove_node', node: change.id });
        }
      }
      if (operations.length) {
        gesturing.current = false;
        edit(operations);
      }
    },
    [edit, presenting],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      if (presenting) return;
      const removals = changes.filter(
        (change): change is EdgeChange<FlowEdge> & { type: 'remove'; id: string } =>
          change.type === 'remove',
      );
      const operations: ClientViewOperation[] = [];
      for (const change of removals) {
        const edge = view.edges.find((e) => e.id === change.id);
        if (edge) operations.push({ op: 'remove_edge', source: edge.source, target: edge.target });
      }
      if (operations.length) edit(operations);
    },
    [edit, presenting, view.edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (presenting || !connection.source || !connection.target) return;
      edit([{ op: 'add_edge', source: connection.source, target: connection.target }]);
    },
    [edit, presenting],
  );

  /** Add a box centred on a point in screen coordinates. */
  const addNodeAt = useCallback(
    (type: string, screen: { x: number; y: number }, after?: string) => {
      const point = flow.screenToFlowPosition(screen);
      edit([
        {
          op: 'add_node',
          name: BLOCK_CATALOG[type as keyof typeof BLOCK_CATALOG].defaultName,
          type: type as ClientNodeModel['type'],
          position: { x: Math.round(point.x - 130), y: Math.round(point.y - 48) },
          ...(after ? { after } : {}),
        },
      ]);
    },
    [edit, flow],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  /** The same palette as the technical canvas — it is the full type picker. */
  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (presenting) return;
      const type = event.dataTransfer.getData('application/diagram-plus-block');
      if (!type || !(type in BLOCK_CATALOG)) return;
      addNodeAt(type, { x: event.clientX, y: event.clientY });
    },
    [addNodeAt, presenting],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      if (presenting || event.defaultPrevented) return;
      const at = { x: event.clientX, y: event.clientY };
      showContextMenu(event, [
        {
          label: 'Add a box',
          items: addBlockSubmenu(catalog, (type) => addNodeAt(type, at)),
        },
        separator,
        { label: 'Tidy up', onSelect: () => store.tidyClientView() },
        {
          label: 'Fit view',
          onSelect: () => void flow.fitView({ padding: 0.2, maxZoom: 1 }),
        },
      ]);
    },
    [addNodeAt, catalog, flow, presenting],
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, flowNode: ClientFlowNode) => {
      if (presenting) return;
      const node = view.nodes.find((n) => n.id === flowNode.id);
      if (!node) return;
      store.selectClient([node.id]);
      const ordered = [...view.nodes].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((n) => n.id === node.id);
      const move = (to: number): void => {
        const next = [...ordered];
        next.splice(to, 0, ...next.splice(index, 1));
        edit([{ op: 'reorder', order: next.map((n) => n.id) }]);
      };

      showContextMenu(event, [
        { kind: 'heading', label: node.name },
        {
          label: 'Add a box after this',
          items: addBlockSubmenu(catalog, (type) =>
            addNodeAt(type, { x: event.clientX, y: event.clientY + 160 }, node.id),
          ),
        },
        separator,
        { label: 'Move earlier', disabled: index <= 0, onSelect: () => move(index - 1) },
        {
          label: 'Move later',
          disabled: index >= ordered.length - 1,
          onSelect: () => move(index + 1),
        },
        separator,
        {
          label: 'Show on the technical diagram',
          disabled: !node.blockId,
          onSelect: () => {
            if (!node.blockId) return;
            store.setView('diagram');
            store.select([node.blockId]);
          },
        },
        separator,
        {
          label: 'Remove',
          danger: true,
          hint: 'Del',
          onSelect: () => edit([{ op: 'remove_node', node: node.id }]),
        },
      ]);
    },
    [addNodeAt, catalog, edit, presenting, view.nodes],
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, flowEdge: FlowEdge) => {
      if (presenting) return;
      const edge = view.edges.find((e) => e.id === flowEdge.id);
      if (!edge) return;
      showContextMenu(event, [
        {
          label: 'Remove this arrow',
          danger: true,
          onSelect: () => edit([{ op: 'remove_edge', source: edge.source, target: edge.target }]),
        },
      ]);
    },
    [edit, presenting, view.edges],
  );

  if (!current) return null;

  return (
    <div
      className="client-canvas"
      style={{ flex: 1, minHeight: 0 }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodeDragStop={() => {
          gesturing.current = false;
        }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={!presenting}
        nodesConnectable={!presenting}
        elementsSelectable={!presenting}
        panOnScroll
        // Double-click renames a box here, so it must not also zoom.
        zoomOnDoubleClick={false}
        deleteKeyCode={presenting ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        {presenting ? null : <Controls showInteractive={false} />}
        {presenting ? null : (
          <MiniMap
            pannable
            nodeColor={(flowNode) => {
              const node = (flowNode.data as ClientFlowNode['data']).node;
              return BLOCK_CATALOG[node.type].color;
            }}
            maskColor="rgb(0 0 0 / 0.3)"
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              width: 170,
              height: 110,
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export function ClientCanvas(props: ClientCanvasProps) {
  return (
    <ReactFlowProvider>
      <ClientCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
