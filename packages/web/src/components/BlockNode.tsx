import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { BLOCK_CATALOG, type Block } from '@diagram-plus/core/browser';

/**
 * How a block is drawn on the canvas.
 *
 * Each type shows two or three "facts" — the details that matter most for that
 * kind of block — so the diagram is readable without opening the inspector.
 */

export type BlockNodeData = { block: Block };
export type BlockFlowNode = Node<BlockNodeData, 'block'>;

interface Fact {
  text: string;
  mono?: boolean;
}

function factsFor(block: Block): Fact[] {
  switch (block.type) {
    case 'ui_screen':
      return [
        block.data.route ? { text: block.data.route, mono: true } : null,
        block.data.components.length ? { text: `${block.data.components.length} components` } : null,
        block.data.actions.length ? { text: `${block.data.actions.length} actions` } : null,
      ].filter(Boolean) as Fact[];

    case 'ui_component':
      return [
        block.data.props.length ? { text: `${block.data.props.length} props` } : null,
        block.data.emits.length ? { text: `${block.data.emits.length} events` } : null,
      ].filter(Boolean) as Fact[];

    case 'api_endpoint':
      return [
        { text: `${block.data.method} ${block.data.path}`, mono: true },
        block.data.auth !== 'none' ? { text: block.data.auth } : null,
      ].filter(Boolean) as Fact[];

    case 'service':
      return block.data.functions.slice(0, 3).map((fn) => ({ text: `${fn.name}()`, mono: true }));

    case 'function':
      return [
        block.data.steps.length ? { text: `${block.data.steps.length} steps` } : null,
        block.data.returns ? { text: `→ ${block.data.returns}`, mono: true } : null,
      ].filter(Boolean) as Fact[];

    case 'data_model':
      return block.data.fields.slice(0, 4).map((f) => ({ text: f.name, mono: true }));

    case 'datastore':
      return block.data.engine ? [{ text: block.data.engine }] : [];

    case 'external_service':
      return [
        block.data.provider ? { text: block.data.provider } : null,
        { text: block.data.protocol },
      ].filter(Boolean) as Fact[];

    case 'job':
      return [
        { text: block.data.trigger },
        block.data.schedule ? { text: block.data.schedule, mono: true } : null,
      ].filter(Boolean) as Fact[];

    case 'event':
      return [
        block.data.channel ? { text: block.data.channel, mono: true } : null,
        block.data.payload.length ? { text: `${block.data.payload.length} fields` } : null,
      ].filter(Boolean) as Fact[];

    case 'decision':
      return block.data.branches.slice(0, 3).map((b) => ({ text: b.label }));

    case 'loop':
      return [
        block.data.over ? { text: `for ${block.data.over}`, mono: true } : null,
        block.data.body.length ? { text: `${block.data.body.length} steps` } : null,
      ].filter(Boolean) as Fact[];

    case 'config':
      return block.data.keys.slice(0, 3).map((k) => ({ text: k.name, mono: true }));

    default:
      return [];
  }
}

function summaryFor(block: Block): string {
  if (block.summary) return block.summary;
  switch (block.type) {
    case 'note':
      return block.data.text;
    case 'ui_screen':
      return block.data.purpose;
    case 'ui_component':
      return block.data.purpose;
    case 'api_endpoint':
      return block.data.summary;
    case 'service':
      return block.data.responsibility;
    case 'decision':
      return block.data.condition;
    case 'datastore':
      return block.data.purpose;
    default:
      return block.description;
  }
}

export function BlockNode({ data, selected }: NodeProps<BlockFlowNode>) {
  const block = data.block;
  const info = BLOCK_CATALOG[block.type];
  const tint = block.color || info.color;
  const facts = factsFor(block);
  const summary = summaryFor(block);

  return (
    <div
      className={`block-node${selected ? ' selected' : ''}`}
      style={{ ['--tint' as string]: tint, position: 'relative' }}
      title={block.description || block.summary || info.description}
    >
      <Handle type="target" position={Position.Left} />
      <span className={`impl ${block.implementation.status}`} title={block.implementation.status} />

      <div className="head">
        <span className="icon" aria-hidden>{info.icon}</span>
        <span className="name">{block.name}</span>
      </div>
      <div className="kind">{info.label}</div>
      {summary ? <div className="summary">{summary}</div> : null}
      {facts.length ? (
        <div className="facts">
          {facts.map((fact, i) => (
            <span key={i} className={`fact${fact.mono ? ' mono' : ''}`}>
              {fact.text}
            </span>
          ))}
        </div>
      ) : null}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
