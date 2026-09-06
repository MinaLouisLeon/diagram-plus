import { useEffect, useState } from 'react';
import {
  BLOCK_CATALOG,
  EDGE_TYPES,
  EDGE_TYPE_INFO,
  type Block,
  type Diagram,
  type Edge,
  type EdgeType,
  type ImplementationStatus,
} from '@diagram-plus/core/browser';
import { FieldForm } from './FieldForm';
import { store, useEditorState } from '../store';

/**
 * The right-hand panel: everything about the selected block or connection.
 * Edits are pushed straight into the store, which debounces them onto disk.
 */

const IMPL_STATUSES: ImplementationStatus[] = ['todo', 'in_progress', 'done', 'blocked'];

export function Inspector() {
  const { current, selectedBlocks, selectedEdges } = useEditorState();
  if (!current) return null;

  if (selectedBlocks.length === 1) {
    const block = current.blocks.find((b) => b.id === selectedBlocks[0]);
    if (block) return <BlockInspector key={block.id} block={block} />;
  }
  if (selectedBlocks.length > 1) {
    return <MultiSelection count={selectedBlocks.length} ids={selectedBlocks} />;
  }
  if (selectedEdges.length === 1) {
    const edge = current.edges.find((e) => e.id === selectedEdges[0]);
    if (edge) return <EdgeInspector key={edge.id} edge={edge} diagram={current} />;
  }
  return <DiagramInspector diagram={current} />;
}

/* ------------------------------------------------------------------ */

function BlockInspector({ block }: { block: Block }) {
  const info = BLOCK_CATALOG[block.type];
  const [name, setName] = useState(block.name);
  const [summary, setSummary] = useState(block.summary);
  const [description, setDescription] = useState(block.description);

  // Re-sync when the block changes underneath us (Claude edited it).
  useEffect(() => {
    setName(block.name);
    setSummary(block.summary);
    setDescription(block.description);
  }, [block.id, block.name, block.summary, block.description]);

  const patch = (changes: Record<string, unknown>) => {
    store.apply([{ op: 'update_block', block: block.id, patch: changes }]);
  };

  return (
    <>
      <header className="inspector-header">
        <span className="icon">{info.icon}</span>
        <div className="meta">
          <strong>{block.name}</strong>
          <span>{info.label}</span>
        </div>
        <button
          className="btn subtle icon"
          title="Delete block"
          onClick={() => store.apply([{ op: 'delete_block', block: block.id }])}
        >
          🗑
        </button>
      </header>

      <div className="inspector-body">
        <div className="field">
          <label>Name</label>
          <input
            className="control"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              patch({ name: e.target.value });
            }}
          />
        </div>

        <div className="field">
          <label>Summary</label>
          <input
            className="control"
            value={summary}
            placeholder="One line shown on the block"
            onChange={(e) => {
              setSummary(e.target.value);
              patch({ summary: e.target.value });
            }}
          />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            className="control"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              patch({ description: e.target.value });
            }}
          />
        </div>

        <div className="section-label">{info.label} details</div>
        <FieldForm
          fields={info.fields}
          value={block.data as Record<string, unknown>}
          onChange={(data) => patch({ data })}
        />

        <div className="section-label">Implementation</div>
        <div className="field">
          <label>Status</label>
          <select
            className="control"
            value={block.implementation.status}
            onChange={(e) =>
              patch({ implementation: { status: e.target.value as ImplementationStatus } })
            }
          >
            {IMPL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        {block.implementation.files.length ? (
          <div className="field">
            <label>Files</label>
            <div className="list-rows">
              {block.implementation.files.map((file) => (
                <code key={file} className="fact mono" style={{ fontSize: 11.5 }}>
                  {file}
                </code>
              ))}
            </div>
          </div>
        ) : null}

        <p className="hint" style={{ marginTop: 18 }}>
          {info.whenToUse}
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function EdgeInspector({ edge, diagram }: { edge: Edge; diagram: Diagram }) {
  const source = diagram.blocks.find((b) => b.id === edge.source);
  const target = diagram.blocks.find((b) => b.id === edge.target);
  const patch = (changes: Record<string, unknown>) => {
    store.apply([{ op: 'update_edge', edge: edge.id, patch: changes }]);
  };

  return (
    <>
      <header className="inspector-header">
        <span className="icon">↔</span>
        <div className="meta">
          <strong>
            {source?.name ?? '?'} → {target?.name ?? '?'}
          </strong>
          <span>Connection</span>
        </div>
        <button
          className="btn subtle icon"
          title="Delete connection"
          onClick={() => store.apply([{ op: 'delete_edge', edge: edge.id }])}
        >
          🗑
        </button>
      </header>

      <div className="inspector-body">
        <div className="field">
          <label>Relationship</label>
          <select
            className="control"
            value={edge.type}
            onChange={(e) => patch({ type: e.target.value as EdgeType })}
          >
            {EDGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {EDGE_TYPE_INFO[type].label} ({type})
              </option>
            ))}
          </select>
          <p className="hint">{EDGE_TYPE_INFO[edge.type].description}</p>
        </div>

        <div className="field">
          <label>Label</label>
          <input
            className="control"
            value={edge.label}
            placeholder={EDGE_TYPE_INFO[edge.type].label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Condition</label>
          <input
            className="control"
            value={edge.condition}
            placeholder="Taken when…"
            onChange={(e) => patch({ condition: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            className="control"
            value={edge.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function MultiSelection({ count, ids }: { count: number; ids: string[] }) {
  return (
    <>
      <header className="inspector-header">
        <div className="meta">
          <strong>{count} blocks selected</strong>
          <span>Multiple selection</span>
        </div>
      </header>
      <div className="inspector-body">
        <button
          className="btn danger"
          onClick={() => store.apply(ids.map((id) => ({ op: 'delete_block', block: id }) as const))}
        >
          Delete {count} blocks
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function DiagramInspector({ diagram }: { diagram: Diagram }) {
  const [goal, setGoal] = useState(diagram.projectGoal);
  const [description, setDescription] = useState(diagram.description);
  const [notes, setNotes] = useState(diagram.notes);

  useEffect(() => {
    setGoal(diagram.projectGoal);
    setDescription(diagram.description);
    setNotes(diagram.notes);
  }, [diagram.slug, diagram.projectGoal, diagram.description, diagram.notes]);

  const commit = (patch: Record<string, unknown>) => store.patchMeta(patch);

  return (
    <>
      <header className="inspector-header">
        <span className="icon">📐</span>
        <div className="meta">
          <strong>{diagram.name}</strong>
          <span>
            {diagram.blocks.length} blocks · {diagram.edges.length} connections
          </span>
        </div>
      </header>

      <div className="inspector-body">
        <p className="hint" style={{ marginTop: 0 }}>
          Select a block to edit it, or drag one in from the palette. These details are carried into
          the specification Claude implements from.
        </p>

        <div className="field">
          <label>Project goal</label>
          <textarea
            className="control"
            value={goal}
            placeholder="What are you building, and for whom?"
            onChange={(e) => setGoal(e.target.value)}
            onBlur={() => commit({ projectGoal: goal })}
          />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            className="control"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => commit({ description })}
          />
        </div>

        <div className="section-label">Tech stack</div>
        {(['language', 'frontend', 'backend', 'database'] as const).map((key) => (
          <StackField key={key} label={key} diagram={diagram} />
        ))}

        <div className="section-label">Notes</div>
        <div className="field">
          <textarea
            className="control"
            value={notes}
            placeholder="Anything else worth recording with the design"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => commit({ notes })}
          />
        </div>
      </div>
    </>
  );
}

function StackField({
  label,
  diagram,
}: {
  label: 'language' | 'frontend' | 'backend' | 'database';
  diagram: Diagram;
}) {
  const [value, setValue] = useState(diagram.techStack[label]);
  useEffect(() => setValue(diagram.techStack[label]), [diagram.slug, diagram.techStack, label]);
  return (
    <div className="field">
      <label style={{ textTransform: 'capitalize' }}>{label}</label>
      <input
        className="control"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => store.patchMeta({ techStack: { [label]: value } })}
      />
    </div>
  );
}
