import { useState, type DragEvent } from 'react';
import { BLOCK_CATALOG, type BlockType } from '@diagram-plus/core/browser';
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
        <button
          key={diagram.slug}
          className={`diagram-item${current?.slug === diagram.slug ? ' active' : ''}`}
          onClick={() => void store.open(diagram.slug)}
        >
          <strong>{diagram.name}</strong>
          <span>
            {diagram.status} · {diagram.blockCount} blocks
          </span>
        </button>
      ))}
    </>
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
