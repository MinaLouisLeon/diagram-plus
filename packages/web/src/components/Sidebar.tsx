import { useState, type DragEvent } from 'react';
import {
  BLOCK_CATALOG,
  type BlockType,
  type DiagramSummary,
} from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';

/**
 * Left rail: the list of diagrams in the project, and the palette of blocks you
 * drag onto the canvas.
 */

export function Sidebar({ onNewDiagram }: { onNewDiagram: () => void }) {
  const [tab, setTab] = useState<'diagrams' | 'palette'>('palette');
  const { current } = useEditorState();

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={tab === 'palette' ? 'active' : ''}
          onClick={() => setTab('palette')}
          disabled={!current}
        >
          Blocks
        </button>
        <button className={tab === 'diagrams' ? 'active' : ''} onClick={() => setTab('diagrams')}>
          Diagrams
        </button>
      </div>
      <div className="sidebar-body">
        {tab === 'palette' && current ? <Palette /> : <DiagramList onNewDiagram={onNewDiagram} />}
      </div>
    </aside>
  );
}

function DiagramList({ onNewDiagram }: { onNewDiagram: () => void }) {
  const { diagrams, current } = useEditorState();
  const [confirming, setConfirming] = useState<DiagramSummary | null>(null);

  return (
    <>
      <button className="btn primary" style={{ width: '100%' }} onClick={onNewDiagram}>
        + New diagram
      </button>
      <div className="section-label">In this project</div>
      {diagrams.length === 0 ? (
        <p className="hint" style={{ padding: '0 4px' }}>
          None yet. Create one here, or ask Claude Code to design one for your project.
        </p>
      ) : null}
      {diagrams.map((diagram) => (
        <div
          key={diagram.slug}
          className={`diagram-row${current?.slug === diagram.slug ? ' active' : ''}`}
        >
          <button className="diagram-item" onClick={() => void store.open(diagram.slug)}>
            <strong>{diagram.name}</strong>
            <span>
              {diagram.status} · {diagram.blockCount} blocks
            </span>
          </button>
          <button
            className="btn subtle icon diagram-delete"
            title={`Delete ${diagram.name}`}
            aria-label={`Delete ${diagram.name}`}
            onClick={() => setConfirming(diagram)}
          >
            🗑
          </button>
        </div>
      ))}

      {confirming ? (
        <DeleteDiagramDialog diagram={confirming} onClose={() => setConfirming(null)} />
      ) : null}
    </>
  );
}

/**
 * Deleting a diagram removes a file from the user's repository, so it asks
 * first and says exactly what is about to go.
 */
function DeleteDiagramDialog({
  diagram,
  onClose,
}: {
  diagram: DiagramSummary;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    await store.deleteDiagram(diagram.slug);
    setBusy(false);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header>Delete “{diagram.name}”?</header>
        <div className="modal-body">
          <p style={{ margin: 0 }}>
            This deletes <code>.diagrams/{diagram.slug}.diagram.json</code> from your project.
            {diagram.blockCount > 0
              ? ` Its ${diagram.blockCount} block${diagram.blockCount === 1 ? '' : 's'} and ${
                  diagram.edgeCount
                } connection${diagram.edgeCount === 1 ? '' : 's'} go with it.`
              : ''}
          </p>
        </div>
        <footer>
          <button className="btn subtle" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={() => void remove()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Palette() {
  const { catalog } = useEditorState();
  if (!catalog) return null;

  const onDragStart = (event: DragEvent, type: BlockType) => {
    event.dataTransfer.setData('application/diagram-plus-block', type);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <>
      <p className="hint" style={{ margin: '2px 4px 8px' }}>
        Drag a block onto the canvas.
      </p>
      {catalog.categories.map((category) => {
        const types = catalog.blockTypes.filter((info) => info.category === category.id);
        if (!types.length) return null;
        return (
          <div key={category.id}>
            <div className="section-label">{category.label}</div>
            {types.map((info) => (
              <div
                key={info.type}
                className="palette-item"
                draggable
                onDragStart={(event) => onDragStart(event, info.type)}
                onDoubleClick={() =>
                  store.apply([
                    {
                      op: 'add_block',
                      block: {
                        type: info.type,
                        name: BLOCK_CATALOG[info.type].defaultName,
                        position: { x: 120, y: 120 },
                      },
                    },
                  ])
                }
                title={info.whenToUse}
              >
                <span
                  className="swatch"
                  style={{ background: `${info.color}22`, border: `1px solid ${info.color}` }}
                >
                  {info.icon}
                </span>
                <span className="meta">
                  <strong>{info.label}</strong>
                  <span>{info.description}</span>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
