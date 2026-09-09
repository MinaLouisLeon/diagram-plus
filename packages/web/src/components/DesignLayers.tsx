import { useState, type DragEvent } from 'react';
import {
  EL_ID,
  factsOf,
  getAttr,
  isElement,
  parseHtml,
  type HtmlElement,
  type HtmlNode,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import { separator, showContextMenu } from '../context-menu';
import { SNIPPETS, SNIPPET_CATEGORIES, type Snippet } from '../design-snippets';
import { store, useEditorState } from '../store';

/**
 * The layers panel and the palette.
 *
 * The canvas is where a screen is judged; this is where it is *addressed*.
 * Nesting is the thing a design editor has to make obvious and a canvas never
 * quite can — whether a button is inside the card or merely on top of it is
 * the difference between a design that builds and one that does not.
 *
 * It reads the screen's markup rather than a typed tree, so what it shows is
 * the real document structure: the tags an implementer will see, not a
 * vocabulary invented for the editor.
 */

export function DesignLayers({ screen }: { screen: ScreenDesign | null }) {
  const { selectedElement } = useEditorState();
  const roots = screen ? topLevel(screen.html) : [];

  return (
    <div className="design-layers">
      <Palette screen={screen} />
      <div className="design-layers-tree">
        <div className="design-panel-head">
          <span className="label">Layers</span>
          {screen ? <span className="hint">{screen.name}</span> : null}
        </div>
        {screen && roots.length ? (
          roots.map((element) => (
            <LayerRow
              key={getAttr(element, EL_ID)}
              element={element}
              screen={screen}
              depth={0}
              selectedId={selectedElement}
            />
          ))
        ) : (
          <p className="hint">
            {screen ? 'This screen is empty. Drag something in.' : 'Pick an artboard to see what is on it.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** The outermost elements of a screen. */
function topLevel(html: string): HtmlElement[] {
  return parseHtml(html).childNodes.filter((node) => isElement(node as HtmlNode)) as HtmlElement[];
}

/** The elements directly inside one, skipping text and comments. */
function childrenOf(element: HtmlElement): HtmlElement[] {
  return element.childNodes.filter((node) => isElement(node as HtmlNode)) as HtmlElement[];
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
   * Beside the selection if there is one, so placing three fields in a row
   * does what it looks like it does; inside the screen otherwise.
   */
  const add = (snippet: Snippet): void => {
    if (!screen) return;
    store.designEdit([
      {
        op: 'insert_html',
        screen: screen.id,
        html: snippet.html,
        target: selectedElement ?? undefined,
        where: selectedElement ? 'after' : 'inside',
      },
    ]);
  };

  return (
    <div className="design-palette">
      <button className="design-panel-head" onClick={() => setOpen(!open)}>
        <span className={`twisty${open ? ' open' : ''}`}>▾</span>
        <span className="label">Add</span>
      </button>

      {open
        ? SNIPPET_CATEGORIES.map((category) => (
            <div key={category} className="design-palette-group">
              <span className="design-palette-label">{category}</span>
              <div className="design-palette-items">
                {SNIPPETS.filter((s) => s.category === category).map((snippet) => (
                  <button
                    key={snippet.id}
                    className="design-palette-item"
                    title={`Add a ${snippet.label.toLowerCase()}`}
                    draggable
                    onDragStart={(event: DragEvent) => {
                      event.dataTransfer.setData('application/x-design-type', snippet.id);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => add(snippet)}
                  >
                    <span className="design-palette-icon">{snippet.icon}</span>
                    {snippet.label}
                  </button>
                ))}
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
  element: HtmlElement;
  screen: ScreenDesign;
  depth: number;
  selectedId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const facts = factsOf(element);
  const children = childrenOf(element);
  const selected = selectedId === facts.id;

  /** Drop resolution, exactly as the canvas does it: inside, or beside. */
  const onDrop = (event: DragEvent): void => {
    const moved = event.dataTransfer.getData('application/x-design-element');
    event.preventDefault();
    event.stopPropagation();

    if (!moved) {
      const snippet = SNIPPETS.find(
        (s) => s.id === event.dataTransfer.getData('application/x-design-type'),
      );
      if (!snippet) return;
      store.designEdit([
        { op: 'insert_html', screen: screen.id, html: snippet.html, target: facts.id, where: 'inside' },
      ]);
      return;
    }
    if (moved === facts.id) return;

    store.designEdit([
      { op: 'move_node', screen: screen.id, element: moved, parent: facts.id },
    ]);
  };

  return (
    <>
      <div
        className={`design-layer${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(event: DragEvent) => {
          event.dataTransfer.setData('application/x-design-element', facts.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event: DragEvent) => {
          if (
            event.dataTransfer.types.includes('application/x-design-element') ||
            event.dataTransfer.types.includes('application/x-design-type')
          ) {
            event.preventDefault();
          }
        }}
        onDrop={onDrop}
        onClick={() => store.selectElement(facts.id, screen.id)}
        onContextMenu={(event) =>
          showContextMenu(event, [
            { kind: 'heading', label: facts.label },
            {
              label: facts.hidden ? 'Show it' : 'Hide it',
              onSelect: () =>
                store.designEdit([
                  {
                    op: 'set_attribute',
                    screen: screen.id,
                    element: facts.id,
                    name: 'hidden',
                    value: facts.hidden ? null : '',
                  },
                ]),
            },
            {
              label: 'Duplicate',
              onSelect: () =>
                store.designEdit([
                  { op: 'duplicate_node', screen: screen.id, element: facts.id },
                ]),
            },
            separator,
            {
              label: 'Remove',
              onSelect: () =>
                store.designEdit([{ op: 'remove_node', screen: screen.id, element: facts.id }]),
            },
          ])
        }
      >
        {children.length ? (
          <span
            className={`twisty${collapsed ? '' : ' open'}`}
            onClick={(event) => {
              event.stopPropagation();
              setCollapsed(!collapsed);
            }}
          >
            ▾
          </span>
        ) : (
          <span className="twisty spacer" />
        )}

        <code className="design-layer-tag">{facts.tag}</code>
        <span className="design-layer-name">{facts.text || facts.classes.join('.')}</span>

        {facts.binding ? <span className="design-layer-flag">bound</span> : null}
        {facts.action || facts.navigatesTo ? <span className="design-layer-flag">acts</span> : null}
        {facts.repeat ? <span className="design-layer-flag">×{facts.repeat.count}</span> : null}
        {facts.hidden ? <span className="design-layer-flag">hidden</span> : null}
      </div>

      {collapsed
        ? null
        : children.map((child) => (
            <LayerRow
              key={getAttr(child, EL_ID)}
              element={child}
              screen={screen}
              depth={depth + 1}
              selectedId={selectedId}
            />
          ))}
    </>
  );
}
