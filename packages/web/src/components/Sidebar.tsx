import { useState, type DragEvent } from 'react';
import {
  BLOCK_CATALOG,
  type BlockType,
  type DiagramSummary,
} from '@diagram-plus/core/browser';
import { separator, showContextMenu } from '../context-menu';
import { store, useEditorState } from '../store';
import { copyText } from '../text-menu';

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

/**
 * Exporting from the list means exporting a diagram that may not be open.
 * Opening it first keeps one rule — an export is always the diagram on screen,
 * unsaved edits and all — instead of a second, quieter path to a file.
 */
async function exportDiagram(slug: string): Promise<void> {
  await store.open(slug);
  if (store.getState().current?.slug === slug) await store.exportCurrent();
}

function DiagramList({ onNewDiagram }: { onNewDiagram: () => void }) {
  const { diagrams, current } = useEditorState();
  const [confirming, setConfirming] = useState<DiagramSummary | null>(null);

  return (
    <div
      className="diagram-list"
      onContextMenu={(event) => {
        // The rows answer for themselves; this is the space around them. Text
        // the user has selected is left to the editing menu.
        if (event.defaultPrevented || window.getSelection()?.toString()) return;
        showContextMenu(event, [
          { label: 'New diagram…', onSelect: onNewDiagram },
          separator,
          { label: 'Import from a file…', onSelect: () => void store.beginImport() },
          {
            label: 'Export all diagrams…',
            disabled: diagrams.length === 0,
            onSelect: () => void store.exportAll(),
          },
        ]);
      }}
    >
      <div className="diagram-list-actions">
        <button className="btn primary" onClick={onNewDiagram}>
          + New diagram
        </button>
        <button
          className="btn"
          onClick={() => void store.beginImport()}
          title="Bring in a diagram someone sent you"
        >
          Import…
        </button>
      </div>
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
          onContextMenu={(event) =>
            showContextMenu(event, [
              { kind: 'heading', label: diagram.name },
              {
                label: 'Open',
                disabled: current?.slug === diagram.slug,
                onSelect: () => void store.open(diagram.slug),
              },
              separator,
              {
                label: 'Export…',
                hint: current?.slug === diagram.slug ? undefined : 'Opens it first',
                onSelect: () => void exportDiagram(diagram.slug),
              },
              {
                label: 'Copy file path',
                onSelect: () => void copyText(`.diagrams/${diagram.slug}.diagram.json`),
              },
              separator,
              { label: 'Delete…', danger: true, onSelect: () => setConfirming(diagram) },
            ])
          }
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
    </div>
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

  const addToCanvas = (type: BlockType) => {
    const added = store.apply([
      {
        op: 'add_block',
        block: {
          type,
          name: BLOCK_CATALOG[type].defaultName,
          position: { x: 120, y: 120 },
        },
      },
    ])?.createdBlocks[0];
    if (added) store.select([added.id]);
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
                onDoubleClick={() => addToCanvas(info.type)}
                onContextMenu={(event) =>
                  showContextMenu(event, [
                    { kind: 'heading', label: `${info.icon} ${info.label}` },
                    { label: 'Add to canvas', onSelect: () => addToCanvas(info.type) },
                    separator,
                    { label: 'Copy type name', onSelect: () => void copyText(info.type) },
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
