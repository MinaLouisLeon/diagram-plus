import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
} from 'react';
import {
  DEVICE_FRAMES,
  EL_ID,
  findHtml,
  getAttr,
  parentOf,
  parseHtml,
  type DesignDocument,
  type DesignOperation,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import { screenDocument } from '../design-css';
import { MEASURED_PROPERTIES } from '../design-style';
import { snippetById } from '../design-snippets';
import { showContextMenu, separator } from '../context-menu';
import { store, useEditorState } from '../store';

/**
 * The design canvas.
 *
 * Artboards on an infinite surface: pan with the background, zoom with the
 * wheel, drag a title bar to move a screen, drag its corner to resize it. Not
 * React Flow — there are no edges here, and a node graph's machinery would
 * only get between the pointer and the screen being drawn.
 *
 * Everything it does becomes a design operation, which is the same vocabulary
 * the MCP tools use. A button dragged into place during a review and a button
 * placed by Claude are the same change arriving by different roads.
 */

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export function DesignCanvas({ design }: { design: DesignDocument }) {
  const { selectedScreen, selectedElement } = useEditorState();
  const surface = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(() => ({
    x: design.canvas.x,
    y: design.canvas.y,
    zoom: design.canvas.zoom,
  }));
  const pan = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const fitted = useRef(false);

  // Artboards are drawn at their real size — 1440 across for a desktop screen
  // — so opening the tab at 100% would land you inside the first one with no
  // idea the others exist. Fit once, then leave the viewport to the user.
  useEffect(() => {
    if (fitted.current || !design.screens.length || !surface.current) return;
    fitted.current = true;
    setViewport(fit(design, surface.current));
  }, [design]);

  /* ---- pan and zoom -------------------------------------------------- */

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    // Ctrl or ⌘ zooms about the pointer, like every canvas; a bare wheel pans,
    // because on a trackpad that is what two fingers already mean.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const box = surface.current?.getBoundingClientRect();
      if (!box) return;
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      setViewport((current) => {
        const next = clamp(current.zoom * (1 - event.deltaY / 500), MIN_ZOOM, MAX_ZOOM);
        const ratio = next / current.zoom;
        return { zoom: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
      return;
    }
    setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
  }, []);

  const startPan = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // Only from the background, and only with the left or middle button —
      // a drag that started on an artboard belongs to that artboard.
      if (event.button !== 0 && event.button !== 1) return;
      if (event.target !== event.currentTarget) return;
      store.selectScreen(null);
      pan.current = { x: viewport.x, y: viewport.y, startX: event.clientX, startY: event.clientY };
    },
    [viewport.x, viewport.y],
  );

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const from = pan.current;
      if (!from) return;
      setViewport((current) => ({
        ...current,
        x: from.x + (event.clientX - from.startX),
        y: from.y + (event.clientY - from.startY),
      }));
    };
    const up = () => {
      pan.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  /* ---- moving an element --------------------------------------------- */

  /**
   * Resolve a drop onto a target into a move operation.
   *
   * The renderer reports either a container to go inside, or a sibling and a
   * side to go next to. Turning the second into a parent and an index needs
   * the tree, which lives here.
   */
  const onMove = useCallback(
    (screen: ScreenDesign) => (elementId: string, target: string, index: number) => {
      const [ref, side] = target.split(':');
      if (!ref) return;

      if (!side) {
        store.designEdit([
          { op: 'move_node', screen: screen.id, element: elementId, parent: ref, index },
        ]);
        return;
      }

      // Dropped beside something rather than into it: the sibling's parent is
      // where it goes, and the index has to account for the element leaving
      // its old place first.
      const fragment = parseHtml(screen.html);
      const sibling = findHtml(fragment, ref);
      const parent = sibling && parentOf(sibling);
      if (!sibling || !parent) return;

      const siblings = parent.childNodes;
      const moving = findHtml(fragment, elementId);
      const from = moving && parentOf(moving) === parent ? siblings.indexOf(moving) : -1;

      let at = siblings.indexOf(sibling) + (side === 'after' ? 1 : 0);
      if (from >= 0 && from < at) at -= 1;

      store.designEdit([
        {
          op: 'move_node',
          screen: screen.id,
          element: elementId,
          parent: getAttr(parent, EL_ID),
          index: at,
        },
      ]);
    },
    [],
  );

  /** Something dropped from the palette lands inside whatever it was dropped on. */
  const onPaletteDrop = useCallback(
    (screen: ScreenDesign) => (event: DragEvent<HTMLDivElement>) => {
      const id = event.dataTransfer.getData('application/x-design-type');
      const snippet = snippetById(id);
      if (!snippet) return;
      event.preventDefault();
      event.stopPropagation();

      store.designEdit([
        {
          op: 'insert_html',
          screen: screen.id,
          html: snippet.html,
          target: store.current.selectedElement ?? undefined,
          where: store.current.selectedElement ? 'after' : 'inside',
        },
      ]);
    },
    [],
  );

  return (
    <div
      ref={surface}
      className="design-canvas"
      onWheel={onWheel}
      onMouseDown={startPan}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return;
        showContextMenu(event, [
          { label: 'Tidy the artboards', onSelect: () => store.tidyDesign() },
          { label: 'Fit to the screens', onSelect: () => setViewport(fit(design, surface.current)) },
          separator,
          { label: 'Update from the diagram', onSelect: () => void store.syncDesign() },
        ]);
      }}
    >
      <div
        className="design-surface"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {[...design.screens]
          .sort((a, b) => a.order - b.order)
          .map((screen) => (
            <Artboard
              key={screen.id}
              screen={screen}
              design={design}
              zoom={viewport.zoom}
              selected={selectedScreen === screen.id}
              selectedElement={selectedScreen === screen.id ? selectedElement : null}
              onMove={onMove(screen)}
              onPaletteDrop={onPaletteDrop(screen)}
              onZoomTo={() => setViewport(fitOne(screen, surface.current))}
            />
          ))}
      </div>

      <div className="design-zoom">
        <button className="btn subtle icon" title="Zoom out" onClick={() => zoomBy(setViewport, 0.8)}>
          −
        </button>
        <button
          className="btn subtle small"
          title="Fit every artboard on screen"
          onClick={() => setViewport(fit(design, surface.current))}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <button className="btn subtle icon" title="Zoom in" onClick={() => zoomBy(setViewport, 1.25)}>
          +
        </button>
      </div>
    </div>
  );
}

function zoomBy(set: (fn: (v: Viewport) => Viewport) => void, factor: number): void {
  set((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A viewport centred on one artboard, as large as it will go.
 *
 * Fitting every screen at once is the right thing on open — you need to know
 * what exists — but four desktop frames side by side land at about 12%, which
 * is fine for seeing and useless for working. Double-clicking a title bar
 * brings that one up to a size you can actually design at.
 */
function fitOne(screen: ScreenDesign, surface: HTMLElement | null): Viewport {
  if (!surface) return { x: 0, y: 0, zoom: 1 };
  const box = surface.getBoundingClientRect();
  const padding = 48;
  const zoom = clamp(
    Math.min(
      (box.width - padding * 2) / screen.frame.width,
      (box.height - padding * 2) / screen.frame.height,
    ),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  return {
    zoom,
    x: (box.width - screen.frame.width * zoom) / 2 - screen.position.x * zoom,
    y: (box.height - screen.frame.height * zoom) / 2 - screen.position.y * zoom,
  };
}

/** A viewport that puts every artboard on screen with a little room around it. */
function fit(design: DesignDocument, surface: HTMLElement | null): Viewport {
  if (!design.screens.length || !surface) return { x: 0, y: 0, zoom: 0.6 };
  const box = surface.getBoundingClientRect();

  const left = Math.min(...design.screens.map((s) => s.position.x));
  const top = Math.min(...design.screens.map((s) => s.position.y));
  const right = Math.max(...design.screens.map((s) => s.position.x + s.frame.width));
  const bottom = Math.max(...design.screens.map((s) => s.position.y + s.frame.height));

  const padding = 80;
  const zoom = clamp(
    Math.min((box.width - padding * 2) / (right - left), (box.height - padding * 2) / (bottom - top)),
    MIN_ZOOM,
    1,
  );
  return {
    zoom,
    x: (box.width - (right - left) * zoom) / 2 - left * zoom,
    y: (box.height - (bottom - top) * zoom) / 2 - top * zoom,
  };
}

/* ------------------------------------------------------------------ *
 * One artboard
 * ------------------------------------------------------------------ */

interface ArtboardProps {
  screen: ScreenDesign;
  design: DesignDocument;
  zoom: number;
  selected: boolean;
  selectedElement: string | null;
  onMove: (elementId: string, target: string, index: number) => void;
  onPaletteDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** Bring this artboard up to a size you can work at. */
  onZoomTo: () => void;
}

function Artboard({
  screen,
  design,
  zoom,
  selected,
  selectedElement,
  onMove,
  onPaletteDrop,
  onZoomTo,
}: ArtboardProps) {
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const resize = useRef<{ width: number; height: number; startX: number; startY: number } | null>(
    null,
  );
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The pointer moves in screen pixels; the canvas is scaled, so every delta
  // has to be divided by the zoom or a drag runs away from the cursor.
  useEffect(() => {
    if (!drag.current && !resize.current) return;

    const move = (event: MouseEvent) => {
      if (drag.current) {
        const from = drag.current;
        setGhost({
          x: from.x + (event.clientX - from.startX) / zoom,
          y: from.y + (event.clientY - from.startY) / zoom,
        });
      }
      if (resize.current) {
        const from = resize.current;
        setSize({
          width: Math.max(240, Math.round(from.width + (event.clientX - from.startX) / zoom)),
          height: Math.max(240, Math.round(from.height + (event.clientY - from.startY) / zoom)),
        });
      }
    };

    const up = () => {
      // Only record a move that actually moved something. A click on the title
      // bar to select an artboard, or a double-click to zoom to it, must not
      // light the Save button and mark the file changed.
      if (
        drag.current &&
        ghost &&
        (Math.round(ghost.x) !== screen.position.x || Math.round(ghost.y) !== screen.position.y)
      ) {
        store.designEdit([
          { op: 'move_screen', screen: screen.id, x: Math.round(ghost.x), y: Math.round(ghost.y) },
        ]);
      }
      if (
        resize.current &&
        size &&
        (size.width !== screen.frame.width || size.height !== screen.frame.height)
      ) {
        store.designEdit([{ op: 'update_screen', screen: screen.id, frame: size }]);
      }
      drag.current = null;
      resize.current = null;
      setGhost(null);
      setSize(null);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [zoom, ghost, size, screen.id, screen.position.x, screen.position.y, screen.frame.width, screen.frame.height]);

  const position = ghost ?? screen.position;
  const frame = size ?? screen.frame;
  const label = screen.variant ? `${screen.name} — ${screen.variant}` : screen.name;

  return (
    <div
      className={`design-artboard${selected ? ' selected' : ''}${screen.orphaned ? ' orphaned' : ''}`}
      style={{ left: position.x, top: position.y, width: frame.width }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className="design-artboard-bar"
        title="Drag to move · double-click to zoom to this screen"
        onDoubleClick={onZoomTo}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          store.selectScreen(screen.id);
          drag.current = {
            x: screen.position.x,
            y: screen.position.y,
            startX: event.clientX,
            startY: event.clientY,
          };
          setGhost({ x: screen.position.x, y: screen.position.y });
        }}
        onContextMenu={(event) =>
          showContextMenu(event, [
            { kind: 'heading', label },
            {
              label: 'Duplicate as a variant…',
              onSelect: () =>
                store.designEdit([{ op: 'duplicate_screen', screen: screen.id, variant: 'Copy' }]),
            },
            ...(screen.blockId
              ? [
                  {
                    label: 'Show on the diagram',
                    onSelect: () => {
                      store.setView('diagram');
                      if (screen.blockId) store.select([screen.blockId]);
                    },
                  },
                ]
              : []),
            separator,
            ...(['mobile', 'tablet', 'desktop', 'wide'] as const).map((device) => ({
              label: `${DEVICE_FRAMES[device].label} — ${DEVICE_FRAMES[device].width}×${DEVICE_FRAMES[device].height}`,
              onSelect: () =>
                store.designEdit([{ op: 'update_screen', screen: screen.id, device }]),
            })),
            separator,
            {
              label: 'Remove this artboard',
              onSelect: () => store.designEdit([{ op: 'remove_screen', screen: screen.id }]),
            },
          ])
        }
      >
        <span className="design-artboard-name">{label}</span>
        {screen.route ? <code>{screen.route}</code> : null}
        <span className="toolbar-spacer" />
        <span className={`design-status ${screen.status}`}>{screen.status}</span>
        <span className="design-artboard-size">
          {frame.width}×{frame.height}
        </span>
      </div>

      <div
        className="design-artboard-body"
        style={{ height: frame.height }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes('application/x-design-type') ||
            event.dataTransfer.types.includes('application/x-design-element')
          ) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes('application/x-design-type')) {
            onPaletteDrop(event);
            return;
          }
          const moved = event.dataTransfer.getData('application/x-design-element');
          if (moved) {
            event.preventDefault();
            onMove(moved, outermostId(screen), -1);
          }
        }}
      >
        <ScreenFrame
          design={design}
          screen={screen}
          zoom={zoom}
          selectedElement={selectedElement}
          onPick={(id) => store.selectElement(id, screen.id)}
          onPickScreen={() => store.selectScreen(screen.id)}
        />
      </div>

      <div
        className="design-artboard-resize"
        title="Drag to resize the frame"
        onMouseDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          store.selectScreen(screen.id);
          resize.current = {
            width: screen.frame.width,
            height: screen.frame.height,
            startX: event.clientX,
            startY: event.clientY,
          };
          setSize({ ...screen.frame });
        }}
      />
    </div>
  );
}

/** The outermost element of a screen — where a drop with no target lands. */
function outermostId(screen: ScreenDesign): string {
  const first = parseHtml(screen.html).childNodes.find((node) => 'tagName' in node);
  return first ? getAttr(first as never, EL_ID) : '';
}

/**
 * A screen, rendered as the page it is.
 *
 * An iframe rather than markup in the editor's own document, for three
 * reasons that all matter: nothing in a design can execute, the design's CSS
 * cannot restyle the toolbar, and — the one that decides it — the editor's own
 * stylesheet cannot leak into the design. A screen has to look here exactly as
 * it will when it is built, and it cannot do that sharing a document with an
 * app that has opinions about what a button looks like.
 *
 * Selection is wired by hand rather than with React: the elements live in
 * another document, so the bridge is `data-el` — read the id off whatever was
 * clicked, and the rest of the editor addresses it by that.
 */
function ScreenFrame({
  design,
  screen,
  zoom,
  selectedElement,
  onPick,
  onPickScreen,
}: {
  design: DesignDocument;
  screen: ScreenDesign;
  zoom: number;
  selectedElement: string | null;
  onPick: (id: string) => void;
  onPickScreen: () => void;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const srcDoc = screenDocument(design, screen);

  /**
   * Read the selected element back off the artboard.
   *
   * The document records what somebody overrode; only the browser knows what
   * an element actually *is*, because nearly all of it comes from the tokens
   * and the shared stylesheet. So the panel's font size, its padding and the
   * handles drawn around a selection all come from here — which is what makes
   * the properties panel a picture of the screen rather than a list of
   * exceptions to it.
   */
  const measure = useCallback((): void => {
    const doc = frame.current?.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view) return;
    if (!selectedElement) {
      if (store.current.selectedScreen === screen.id) store.measureElement(null);
      return;
    }

    const found = doc.querySelector(`[data-el="${CSS.escape(selectedElement)}"]`);
    if (!(found instanceof view.HTMLElement)) {
      store.measureElement(null);
      return;
    }

    const style = view.getComputedStyle(found);
    const computed: Record<string, string> = {};
    for (const property of MEASURED_PROPERTIES) {
      computed[property] = style.getPropertyValue(property).trim();
    }

    const box = found.getBoundingClientRect();
    store.measureElement({
      screen: screen.id,
      element: selectedElement,
      box: {
        x: box.left + view.scrollX,
        y: box.top + view.scrollY,
        width: box.width,
        height: box.height,
      },
      computed,
    });
  }, [screen.id, selectedElement]);

  /**
   * Mark what is selected inside the frame.
   *
   * Selection is chrome, not content, so it is a class toggled in the frame
   * rather than anything in the document — clicking something must not rewrite
   * the screen. It has to be re-applied after every reload as well as every
   * click: an edit replaces the whole document, and an outline painted onto
   * the document that edit threw away leaves you working on a screen with
   * nothing visibly selected.
   */
  const paint = useCallback((): void => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    for (const marked of doc.querySelectorAll('.dz-selected')) {
      marked.classList.remove('dz-selected');
    }
    if (!selectedElement) return;
    doc.querySelector(`[data-el="${CSS.escape(selectedElement)}"]`)?.classList.add('dz-selected');
  }, [selectedElement]);

  // Re-bind whenever the document is replaced: a fresh load is a fresh DOM,
  // and the listeners went with the old one.
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;

    const bind = (): void => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      const click = (event: Event): void => {
        onPickScreen();
        // The innermost thing under the pointer wins, which is what clicking
        // a button inside a card has to mean.
        const target = (event.target as HTMLElement | null)?.closest?.('[data-el]');
        const id = target?.getAttribute('data-el');
        if (id) onPick(id);
      };

      doc.addEventListener('click', click);
      // A fresh document has just been laid out. The selection has to be
      // painted onto it again, and any measurement taken against the old one
      // describes markup that no longer exists.
      paint();
      measure();
      return;
    };

    if (iframe.contentDocument?.readyState === 'complete') bind();
    iframe.addEventListener('load', bind);
    return () => iframe.removeEventListener('load', bind);
  }, [srcDoc, onPick, onPickScreen, measure, paint]);

  // Clicking something repaints without reloading, which is what keeps
  // selection instant on a screen of any size.
  useEffect(() => {
    paint();
    measure();
  }, [selectedElement, srcDoc, measure, paint]);

  /** The element inside the frame, for a drag that wants to show its work. */
  const liveElement = useCallback((): HTMLElement | null => {
    const doc = frame.current?.contentDocument;
    const view = doc?.defaultView;
    if (!doc || !view || !selectedElement) return null;
    const found = doc.querySelector(`[data-el="${CSS.escape(selectedElement)}"]`);
    return found instanceof view.HTMLElement ? found : null;
  }, [selectedElement]);

  return (
    <>
      <iframe
        ref={frame}
        className="design-artboard-frame"
        title={screen.name}
        // No allow-scripts: nothing in a design runs. allow-same-origin is what
        // lets the editor reach in to resolve a click.
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
      />
      <ElementHandles
        screen={screen}
        element={selectedElement}
        zoom={zoom}
        liveElement={liveElement}
        onSettled={measure}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sizing an element by eye
 * ------------------------------------------------------------------ */

type Grip = 'e' | 's' | 'se';

/**
 * The handles around the selected element.
 *
 * Typing 240 into a box is a fine way to record a width and a poor way to find
 * one. These are drawn over the iframe rather than inside it — the design's own
 * document stays exactly what will be built, with no editor furniture in it —
 * and they write the same `set_style` operation the properties panel does.
 *
 * While the pointer is down the size goes straight onto the element in the
 * frame, so the screen reflows under the drag as it will when it is built.
 * Nothing reaches the document until the button comes up, which is what keeps
 * one drag to one undo step.
 */
function ElementHandles({
  screen,
  element,
  zoom,
  liveElement,
  onSettled,
}: {
  screen: ScreenDesign;
  element: string | null;
  zoom: number;
  liveElement: () => HTMLElement | null;
  onSettled: () => void;
}) {
  const { measured } = useEditorState();
  const [dragging, setDragging] = useState<{ width: number; height: number } | null>(null);
  const grip = useRef<{
    grip: Grip;
    startX: number;
    startY: number;
    width: number;
    height: number;
    node: HTMLElement;
  } | null>(null);

  const box =
    measured && measured.element === element && measured.screen === screen.id ? measured.box : null;

  useEffect(() => {
    if (!grip.current) return;

    const move = (event: MouseEvent): void => {
      const from = grip.current;
      if (!from) return;
      // The canvas is scaled, so a pointer that moved 100 screen pixels moved
      // 100/zoom design pixels. Without this the element runs off the cursor.
      const next = {
        width:
          from.grip === 's'
            ? Math.round(from.width)
            : Math.max(8, Math.round(from.width + (event.clientX - from.startX) / zoom)),
        height:
          from.grip === 'e'
            ? Math.round(from.height)
            : Math.max(8, Math.round(from.height + (event.clientY - from.startY) / zoom)),
      };
      if (from.grip !== 's') from.node.style.width = `${next.width}px`;
      if (from.grip !== 'e') from.node.style.height = `${next.height}px`;
      setDragging(next);
    };

    const up = (): void => {
      const from = grip.current;
      grip.current = null;
      const size = dragging;
      setDragging(null);
      if (!from || !element) return;

      // A click on a handle that moved nothing must not light the Save button,
      // exactly as a click on an artboard's title bar must not.
      const still =
        !size ||
        (size.width === Math.round(from.width) && size.height === Math.round(from.height));
      if (still) {
        onSettled();
        return;
      }

      store.designEdit([
        {
          op: 'set_style',
          screen: screen.id,
          element,
          styles: {
            ...(from.grip === 's' ? {} : { width: `${size.width}px` }),
            ...(from.grip === 'e' ? {} : { height: `${size.height}px` }),
          },
        },
      ]);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [zoom, dragging, element, screen.id, onSettled]);

  if (!box || !element) return null;

  const start = (which: Grip) => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const node = liveElement();
    if (!node) return;
    grip.current = {
      grip: which,
      startX: event.clientX,
      startY: event.clientY,
      width: box.width,
      height: box.height,
      node,
    };
    setDragging({ width: Math.round(box.width), height: Math.round(box.height) });
  };

  const size = dragging ?? { width: Math.round(box.width), height: Math.round(box.height) };
  // Handles keep their size on screen however far the canvas is zoomed out —
  // at 20% an unscaled grip is three pixels of nothing to aim at.
  const grips: Grip[] = ['e', 's', 'se'];

  return (
    <div
      className="dz-handles"
      style={{ left: box.x, top: box.y, width: size.width, height: size.height }}
    >
      {grips.map((which) => (
        <div
          key={which}
          className={`dz-grip ${which}`}
          style={{ transform: `scale(${1 / zoom})` }}
          onMouseDown={start(which)}
        />
      ))}
      <span className="dz-handles-size" style={{ transform: `scale(${1 / zoom})` }}>
        {size.width} × {size.height}
      </span>
    </div>
  );
}

/** Design operations, re-exported so callers do not import core for the type. */
export type { DesignOperation };
