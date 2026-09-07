import { useEffect, useRef, useState } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BLOCK_CATALOG, clientWordFor, type ClientNode as ClientNodeModel } from '@diagram-plus/core/browser';
import { store } from '../store';

/**
 * A box in the client view.
 *
 * Deliberately plainer than a block on the technical canvas: a name, one line
 * under it, and a word for what kind of thing it is. No routes, no methods, no
 * field counts — the whole point is that the person reading it has never seen
 * a block diagram.
 *
 * The name is edited in place, because renaming something while a client is
 * describing it should not mean going and finding a form.
 */

export type ClientNodeData = { node: ClientNodeModel; presenting: boolean };
export type ClientFlowNode = Node<ClientNodeData, 'client'>;

export function ClientNode({ data, selected }: NodeProps<ClientFlowNode>) {
  const { node, presenting } = data;
  const info = BLOCK_CATALOG[node.type];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(node.name);
  }, [node.name, editing]);

  const commit = (): void => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== node.name) store.clientEdit([{ op: 'update_node', node: node.id, name }]);
    else setDraft(node.name);
  };

  const marks: string[] = [];
  if (!node.blockId) marks.push('new');
  if (node.edited) marks.push('reworded');
  if (node.orphaned) marks.push('gone from the diagram');

  return (
    <div
      className={`client-node${selected ? ' selected' : ''}${node.orphaned ? ' orphaned' : ''}${
        node.blockId ? '' : ' fresh'
      }`}
      style={{ ['--tint' as string]: info.color }}
      title={node.note || node.description}
      onDoubleClick={(event) => {
        if (presenting) return;
        event.preventDefault();
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div className="client-node-head">
        {editing ? (
          <input
            ref={input}
            className="client-node-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(node.name);
                setEditing(false);
              }
              event.stopPropagation();
            }}
          />
        ) : (
          <span className="client-node-name">{node.name}</span>
        )}
        <span className="client-node-kind">{clientWordFor(node.type)}</span>
      </div>

      {node.condition ? <div className="client-node-asks">{node.condition}</div> : null}
      {node.description ? <div className="client-node-line">{node.description}</div> : null}

      {node.branches.length ? (
        <div className="client-node-branches">
          {node.branches.map((branch, index) => (
            <span key={index} className="client-branch">
              {branch.label}
            </span>
          ))}
        </div>
      ) : null}

      {marks.length && !presenting ? (
        <div className="client-node-marks">
          {marks.map((mark) => (
            <span key={mark} className={`client-mark ${mark.split(' ')[0]}`}>
              {mark}
            </span>
          ))}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
