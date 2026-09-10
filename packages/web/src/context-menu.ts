import { useSyncExternalStore } from 'react';

/**
 * One context menu for the whole editor.
 *
 * A right-click is either a menu or nothing: every surface that has something
 * useful to offer opens this menu, and `ContextMenuHost` suppresses the
 * browser's own menu everywhere else. Nothing in the app ever shows the native
 * menu, so a right-click that does nothing is a deliberate answer rather than
 * a page-reload-and-view-source menu leaking through the editor.
 */

export interface MenuItem {
  kind?: 'item';
  label: string;
  /** Right-aligned: a keyboard shortcut, or why the item is unavailable. */
  hint?: string;
  icon?: string;
  /** Draws in the danger colour — for the ones that remove something. */
  danger?: boolean;
  disabled?: boolean;
  /** Shows a tick. Use for the value a submenu currently holds. */
  checked?: boolean;
  onSelect?: () => void;
  /** A submenu. An item with children never fires `onSelect`. */
  items?: MenuEntry[];
}

export interface MenuSeparator {
  kind: 'separator';
}

export interface MenuHeading {
  kind: 'heading';
  label: string;
}

export type MenuEntry = MenuItem | MenuSeparator | MenuHeading;

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  entries: MenuEntry[];
  /** Bumped on every open, so the menu remounts with fresh keyboard state. */
  seq: number;
}

const CLOSED: ContextMenuState = { open: false, x: 0, y: 0, entries: [], seq: 0 };

class ContextMenuStore {
  private state: ContextMenuState = CLOSED;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ContextMenuState => this.state;

  private set(next: ContextMenuState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Returns false when there was nothing worth showing. */
  open(x: number, y: number, entries: MenuEntry[]): boolean {
    const trimmed = tidy(entries);
    if (!trimmed.length) {
      this.close();
      return false;
    }
    this.set({ open: true, x, y, entries: trimmed, seq: this.state.seq + 1 });
    return true;
  }

  close(): void {
    if (!this.state.open) return;
    this.set({ ...this.state, open: false, entries: [] });
  }
}

export const contextMenu = new ContextMenuStore();

export function useContextMenuState(): ContextMenuState {
  return useSyncExternalStore(contextMenu.subscribe, contextMenu.getState, contextMenu.getState);
}

/**
 * Open the menu for a right-click. Always claims the event, so the native menu
 * stays away even when the caller ends up with nothing to show.
 */
export function showContextMenu(
  event: { clientX: number; clientY: number; preventDefault: () => void },
  entries: MenuEntry[],
): void {
  event.preventDefault();
  contextMenu.open(event.clientX, event.clientY, entries);
}

export const separator: MenuSeparator = { kind: 'separator' };

export function isItem(entry: MenuEntry): entry is MenuItem {
  return entry.kind === undefined || entry.kind === 'item';
}

/**
 * Drop separators that ended up leading, trailing or doubled — menus are built
 * from conditional pieces, so gaps are normal and should not show as rules.
 */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      const previous = out[out.length - 1];
      if (!previous || previous.kind === 'separator') continue;
    }
    out.push(entry);
  }
  while (out.length && out[out.length - 1]?.kind === 'separator') out.pop();
  // A menu of nothing but headings is a menu with nothing to do.
  return out.some(isItem) ? out : [];
}
