import { useState, type DragEvent } from 'react';
import {
  ELEMENT_CATALOG,
  ELEMENT_CATEGORIES,
  ELEMENT_TYPES,
  elementLabel,
  findElement,
  isContainer,
  type DesignElement,
  type ElementType,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import { separator, showContextMenu } from '../context-menu';
import { store, useEditorState } from '../store';

/**
 * The layers panel and the palette.
 *
 * The canvas is where a screen is judged; this is where it is *addressed*.
 * Nesting is the thing a wireframe editor has to make obvious and a canvas
 * never quite can — whether a button is inside the card or merely on top of
 * it is the difference between a design that builds and one that does not.
 */

export function DesignLayers({ screen }: { screen: ScreenDesign | null }) {
  const { selectedElement } = useEditorState();

  return (
    <div className="design-layers">
      <Palette screen={screen} />
      <div className="design-layers-tree">
        <div className="design-panel-head">
          <span className="label">Layers</span>
          {screen ? <span className="hint">{screen.name}</span> : null}
        </div>
        {screen ? (
          <LayerRow
            element={screen.root}
            screen={screen}
            depth={0}
            selectedId={selectedElement}
          />
        ) : (
          <p className="hint">Pick an artboard to see what is on it.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The palette
 * ------------------------------------------------------------------ */

function Palette({ screen }: { screen: ScreenDesign | null }) {
  const { selectedElement } = useEditorState();
  const [open, setOpen] = useState(true);

  /**
   * Where a click on the palette puts things.
   *
   * Into the selected element when it can hold children, otherwise beside it,
   * and failing that at the end of the screen. Dragging is the precise way;
   * clicking is the fast way, and it should land somewhere sensible rather
   * than always at the bottom of the page.
   */
  const add = (type: ElementType): void => {
    if (!screen) return;
    const selected = selectedElement ? findElement(screen.root, selectedElement) : null;

    if (selected && isContainer(selected.element.type)) {
      store.designEdit([{ op: 'add_element', screen: screen.id, type, parent: selected.element.id }]);
      return;
    }
    if (selected?.parent) {
      store.designEdit([
        {
          op: 'add_element',
          screen: screen.id,
          type,
          parent: selected.parent.id,
          index: selected.index + 1,
        },
      ]);
      return;
    }
    store.designEdit([{ op: 'add_element', screen: screen.id, type }]);
  };

  return (
    <div className="design-palette">
      <div className="design-panel-head">
        <button className="btn subtle icon" onClick={() => setOpen((value) => !value)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="label">Add</span>
      </div>
      {open
        ? ELEMENT_CATEGORIES.map((category) => (
            <div key={category.id} className="design-palette-group">
              <span className="design-palette-label">{category.label}</span>
              <div className="design-palette-items">
                {ELEMENT_TYPES.filter((type) => ELEMENT_CATALOG[type].category === category.id).map(
                  (type) => {
                    const info = ELEMENT_CATALOG[type];
                    return (
                      <button
                        key={type}
                        className="design-palette-item"
                        disabled={!screen}
                        draggable={Boolean(screen)}
                        onDragStart={(event: DragEvent) => {
                          event.dataTransfer.setData('application/x-design-type', type);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => add(type)}
                        title={`${info.label} — ${info.description}\n\n${info.whenToUse}`}
                      >
                        <span aria-hidden="true">{info.icon}</span>
                        {info.label}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          ))
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The tree
 * ------------------------------------------------------------------ */

function LayerRow({
  element,
  screen,
  depth,
  selectedId,
}: {
  element: DesignElement;
  screen: ScreenDesign;
  depth: number;
  selectedId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const info = ELEMENT_CATALOG[element.type];
  const name = elementLabel(element.type, element.name, element.text);
  const selected = selectedId === element.id;
  const root = element.id === screen.root.id;

  return (
    <>
      <div
        className={`design-layer${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => store.selectElement(element.id, screen.id)}
        draggable={!root}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData('application/x-design-element', element.id);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('application/x-design-element')) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          const moved = event.dataTransfer.getData('application/x-design-element');
          if (!moved || moved === element.id) return;
          event.preventDefault();
          event.stopPropagation();

          // Onto a container goes inside it; onto anything else goes after it.
          if (isContainer(element.type)) {
            store.designEdit([
              { op: 'move_element', screen: screen.id, element: moved, parent: element.id },
            ]);
            return;
          }
          const found = findElement(screen.root, element.id);
          if (!found?.parent) return;
          store.designEdit([
            {
              op: 'move_element',
              screen: screen.id,
              element: moved,
              parent: found.parent.id,
              index: found.index + 1,
            },
          ]);
        }}
        onContextMenu={(event) =>
          showContextMenu(event, [
            { kind: 'heading', label: `${name} — ${info.label}` },
            {
              label: element.hidden ? 'Show' : 'Hide',
              onSelect: () =>
                store.designEdit([
                  {
                    op: 'update_element',
                    screen: screen.id,
                    element: element.id,
                    hidden: !element.hidden,
                  },
                ]),
            },
            {
              label: element.locked ? 'Unlock' : 'Lock',
              hint: 'A locked element cannot be dragged on the canvas',
              onSelect: () =>
                store.designEdit([
                  {
                    op: 'update_element',
                    screen: screen.id,
                    element: element.id,
                    locked: !element.locked,
                  },
                ]),
            },
            separator,
            {
              label: 'Duplicate',
              disabled: root,
              onSelect: () =>
                store.designEdit([
                  { op: 'duplicate_element', screen: screen.id, element: element.id },
                ]),
            },
            {
              label: 'Remove',
              disabled: root,
              hint: root ? 'The screen itself' : undefined,
              onSelect: () =>
                store.designEdit([
                  { op: 'remove_element', screen: screen.id, element: element.id },
                ]),
            },
          ])
        }
      >
        {element.children.length ? (
          <button
            className="design-layer-twist"
            onClick={(event) => {
              event.stopPropagation();
              setCollapsed((value) => !value);
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="design-layer-twist" />
        )}
        <span className="design-layer-icon" aria-hidden="true">
          {info.icon}
        </span>
        <span className="design-layer-name">{name}</span>
        {element.binding ? <span className="design-layer-tag">bound</span> : null}
        {element.action || element.navigatesTo ? (
          <span className="design-layer-tag act">acts</span>
        ) : null}
        {element.hidden ? <span className="design-layer-tag">hidden</span> : null}
      </div>

      {collapsed
        ? null
        : element.children.map((child) => (
            <LayerRow
              key={child.id}
              element={child}
              screen={screen}
              depth={depth + 1}
              selectedId={selectedId}
            />
          ))}
    </>
  );
}
