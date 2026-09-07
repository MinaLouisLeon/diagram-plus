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
  ELEMENT_CATALOG,
  findElement,
  isContainer,
  type DesignDocument,
  type DesignOperation,
  type ElementType,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import { ElementView } from './ElementView';
import { screenBackground } from '../design-css';
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
          { op: 'move_element', screen: screen.id, element: elementId, parent: ref, index },
        ]);
        return;
      }

      const sibling = findElement(screen.root, ref);
      if (!sibling?.parent) return;
      // Dropping something onto a sibling that is already just before it in
      // the same list would be a no-op; the index still has to account for the
      // element leaving its old place first.
      const moving = findElement(screen.root, elementId);
      const sameParent = moving?.parent?.id === sibling.parent.id;
      let at = sibling.index + (side === 'after' ? 1 : 0);
      if (sameParent && moving && moving.index < at) at -= 1;

      store.designEdit([
        { op: 'move_element', screen: screen.id, element: elementId, parent: sibling.parent.id, index: at },
      ]);
    },
    [],
  );

  /** Something dropped from the palette lands inside whatever it was dropped on. */
  const onPaletteDrop = useCallback(
    (screen: ScreenDesign) => (event: DragEvent<HTMLDivElement>) => {
      const type = event.dataTransfer.getData('application/x-design-type') as ElementType;
      if (!type || !ELEMENT_CATALOG[type]) return;
      event.preventDefault();
      event.stopPropagation();

      // Walk out from whatever is under the pointer to the nearest container.
      const node = (event.target as HTMLElement).closest('[data-element]');
      const id = node?.getAttribute('data-element') ?? screen.root.id;
      let parent = findElement(screen.root, id);
      while (parent && !isContainer(parent.element.type)) {
        parent = parent.parent ? findElement(screen.root, parent.parent.id) : null;
      }

      store.designEdit([
        {
          op: 'add_element',
          screen: screen.id,
          type,
          parent: parent?.element.id ?? screen.root.id,
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
        style={{
          height: frame.height,
          background: screenBackground(design.system, screen.background),
        }}
        onClick={() => store.selectScreen(screen.id)}
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
            onMove(moved, screen.root.id, -1);
          }
        }}
      >
        <ElementView
          element={screen.root}
          system={design.system}
          selectedId={selectedElement}
          onSelect={(id) => store.selectElement(id, screen.id)}
          onMove={onMove}
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

/** Design operations, re-exported so callers do not import core for the type. */
export type { DesignOperation };
