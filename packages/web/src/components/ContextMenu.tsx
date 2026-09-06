import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  contextMenu,
  isItem,
  useContextMenuState,
  type MenuEntry,
  type MenuItem,
} from '../context-menu';
import { textMenuFor } from '../text-menu';

/**
 * Renders the one context menu, and takes the native one away.
 *
 * Every surface that has a menu opens it from its own handler, which claims the
 * event. Anything still unclaimed by the time the click reaches the window is a
 * place with nothing to offer: it gets the editing menu if there is text under
 * the pointer, and otherwise nothing at all.
 */

const EDGE_GAP = 8;

export function ContextMenuHost() {
  const state = useContextMenuState();

  useEffect(() => {
    const onNativeMenu = (event: MouseEvent) => {
      // A component already decided what this click means.
      if (event.defaultPrevented) return;
      event.preventDefault();
      contextMenu.open(event.clientX, event.clientY, textMenuFor(event.target));
    };
    window.addEventListener('contextmenu', onNativeMenu);
    return () => window.removeEventListener('contextmenu', onNativeMenu);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const close = () => contextMenu.close();
    // Escape is handled here as well as in the menu: right-clicking a button
    // leaves the focus on the button, so the keystroke may never reach it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [state.open]);

  if (!state.open) return null;

  return (
    <div
      className="context-menu-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) contextMenu.close();
      }}
      onWheel={() => contextMenu.close()}
      onContextMenu={(event) => {
        event.preventDefault();
        contextMenu.close();
      }}
    >
      <MenuPanel
        key={state.seq}
        entries={state.entries}
        x={state.x}
        y={state.y}
        onDismiss={() => contextMenu.close()}
      />
    </div>
  );
}

interface MenuPanelProps {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** Where to put the right edge when the menu will not fit to the right. */
  flipX?: number;
  onDismiss: () => void;
  /** Called when a submenu wants to hand navigation back to its parent. */
  onBack?: () => void;
}

function MenuPanel({ entries, x, y, flipX, onDismiss, onBack }: MenuPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y, ready: false });
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [active, setActive] = useState(-1);

  // Measure, then keep the whole menu on screen.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + width > window.innerWidth - EDGE_GAP) {
      left = flipX !== undefined ? flipX - width : window.innerWidth - width - EDGE_GAP;
    }
    if (top + height > window.innerHeight - EDGE_GAP) {
      top = window.innerHeight - height - EDGE_GAP;
    }
    setPlace({ left: Math.max(EDGE_GAP, left), top: Math.max(EDGE_GAP, top), ready: true });
  }, [entries, x, y, flipX]);

  // Keys go to the deepest open menu; closing a submenu hands them back.
  //
  // The browser gives focus to whatever was right-clicked *after* the event is
  // handled, so a menu opened on a button has to claim it again next frame.
  useEffect(() => {
    if (openSub !== null) return;
    const take = () => panel.current?.focus({ preventScroll: true });
    take();
    const frame = requestAnimationFrame(take);
    return () => cancelAnimationFrame(frame);
  }, [openSub]);

  const indexes = entries.map((entry, index) => (isItem(entry) && !entry.disabled ? index : -1));
  const selectable = indexes.filter((index) => index >= 0);

  const step = (delta: number) => {
    if (!selectable.length) return;
    const at = selectable.indexOf(active);
    const next =
      at < 0
        ? selectable[delta > 0 ? 0 : selectable.length - 1]
        : selectable[(at + delta + selectable.length) % selectable.length];
    setActive(next ?? -1);
    setOpenSub(null);
  };

  const choose = (index: number) => {
    const entry = entries[index];
    if (!entry || !isItem(entry) || entry.disabled) return;
    if (entry.items?.length) {
      setActive(index);
      setOpenSub(index);
      return;
    }
    onDismiss();
    entry.onSelect?.();
  };

  return (
    <div
      ref={panel}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: place.left, top: place.top, visibility: place.ready ? 'visible' : 'hidden' }}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            step(1);
            break;
          case 'ArrowUp':
            event.preventDefault();
            step(-1);
            break;
          case 'ArrowRight': {
            const entry = active >= 0 ? entries[active] : undefined;
            if (entry && isItem(entry) && entry.items?.length) {
              event.preventDefault();
              setOpenSub(active);
            }
            break;
          }
          case 'ArrowLeft':
            if (onBack) {
              event.preventDefault();
              onBack();
            }
            break;
          case 'Enter':
          case ' ':
            event.preventDefault();
            if (active >= 0) choose(active);
            break;
          case 'Escape':
            event.preventDefault();
            if (onBack) onBack();
            else onDismiss();
            break;
          case 'Tab':
            event.preventDefault();
            onDismiss();
            break;
        }
      }}
    >
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') return <div key={index} className="context-menu-rule" />;
        if (entry.kind === 'heading') {
          return (
            <div key={index} className="context-menu-heading">
              {entry.label}
            </div>
          );
        }
        return (
          <MenuRow
            key={index}
            item={entry}
            active={active === index}
            submenuOpen={openSub === index}
            onEnter={() => {
              setActive(index);
              setOpenSub(entry.items?.length ? index : null);
            }}
            onChoose={() => choose(index)}
            onDismiss={onDismiss}
            onCloseSubmenu={() => setOpenSub(null)}
          />
        );
      })}
    </div>
  );
}

interface MenuRowProps {
  item: MenuItem;
  active: boolean;
  submenuOpen: boolean;
  onEnter: () => void;
  onChoose: () => void;
  onDismiss: () => void;
  onCloseSubmenu: () => void;
}

function MenuRow({
  item,
  active,
  submenuOpen,
  onEnter,
  onChoose,
  onDismiss,
  onCloseSubmenu,
}: MenuRowProps) {
  const row = useRef<HTMLButtonElement>(null);
  const hasSubmenu = Boolean(item.items?.length);
  const rect = submenuOpen ? row.current?.getBoundingClientRect() : undefined;

  return (
    <>
      <button
        ref={row}
        type="button"
        role="menuitem"
        className={`context-menu-item${active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
        aria-disabled={item.disabled || undefined}
        aria-haspopup={hasSubmenu || undefined}
        aria-expanded={hasSubmenu ? submenuOpen : undefined}
        disabled={item.disabled}
        onMouseEnter={onEnter}
        onClick={onChoose}
      >
        <span className="tick">{item.checked ? '✓' : item.icon ?? ''}</span>
        <span className="label">{item.label}</span>
        {hasSubmenu ? <span className="arrow">›</span> : null}
        {!hasSubmenu && item.hint ? <span className="hint">{item.hint}</span> : null}
      </button>
      {submenuOpen && rect && item.items ? (
        <MenuPanel
          entries={item.items}
          x={rect.right - 4}
          y={rect.top - 4}
          flipX={rect.left + 4}
          onDismiss={onDismiss}
          onBack={onCloseSubmenu}
        />
      ) : null}
    </>
  );
}
