import { separator, type MenuEntry } from './context-menu';
import { store } from './store';

/**
 * The editing menu.
 *
 * The native menu is gone everywhere, so cut/copy/paste has to be ours. This
 * builds the menu for whatever was right-clicked — a text field, an editable
 * region, or a stretch of selected text — and does the clipboard work itself.
 *
 * Values are written back through the native setter and an `input` event so a
 * React-controlled field sees the change; assigning `.value` would be painted
 * over on the next render.
 */

type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Input types with a caret. `number` has one but no selection range. */
const TEXTUAL_INPUTS = new Set(['', 'text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** Where "Select all" stops when the click was not in a text field. */
const SELECTION_SCOPES = 'pre, .panel-body, .inspector-body, .modal-body, .empty .inner, .toast';

export function textMenuFor(target: EventTarget | null): MenuEntry[] {
  const element = target instanceof Element ? target : null;
  if (!element) return [];

  const field = asTextField(element);
  if (field) return fieldMenu(field);

  const editable = element.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"]');
  if (editable) return editableMenu(editable);

  return selectionMenu(element);
}

/* ---- text fields ------------------------------------------------------- */

function asTextField(element: Element): TextField | null {
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement && TEXTUAL_INPUTS.has(element.type)) return element;
  return null;
}

function fieldMenu(field: TextField): MenuEntry[] {
  const editable = !field.readOnly && !field.disabled;
  const range = rangeOf(field);
  const selected = range ? field.value.slice(range.start, range.end) : '';
  const hasSelection = selected.length > 0;
  const hasValue = field.value.length > 0;

  if (!editable) {
    return [
      { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSelection, onSelect: () => copyFrom(field, selected) },
      separator,
      { label: 'Select all', hint: 'Ctrl+A', disabled: !hasValue, onSelect: () => selectAllIn(field) },
    ];
  }

  const readable = canReadClipboard();
  return [
    {
      label: 'Cut',
      hint: 'Ctrl+X',
      disabled: !hasSelection,
      onSelect: () => {
        if (!range) return;
        copyFrom(field, selected);
        replaceRange(field, range, '');
      },
    },
    { label: 'Copy', hint: 'Ctrl+C', disabled: !hasSelection, onSelect: () => copyFrom(field, selected) },
    {
      label: 'Paste',
      hint: readable ? 'Ctrl+V' : 'press Ctrl+V',
      disabled: !readable,
      onSelect: () => {
        // Focused first: reading the clipboard may put a permission prompt in
        // front of the user, and Ctrl+V should land in the right place if they
        // reach for it instead.
        focusField(field, range);
        void readClipboard().then((text) => {
          const target = rangeOf(field) ?? range;
          if (text && target) replaceRange(field, target, text);
        });
      },
    },
    {
      label: 'Delete',
      disabled: !hasSelection,
      onSelect: () => {
        if (range) replaceRange(field, range, '');
      },
    },
    separator,
    { label: 'Select all', hint: 'Ctrl+A', disabled: !hasValue, onSelect: () => selectAllIn(field) },
  ];
}

interface Range {
  start: number;
  end: number;
}

/** `number` inputs have no selection range, and reading it throws in Safari. */
function rangeOf(field: TextField): Range | null {
  try {
    const { selectionStart, selectionEnd } = field;
    if (selectionStart === null || selectionEnd === null) return null;
    return { start: selectionStart, end: selectionEnd };
  } catch {
    return null;
  }
}

function focusField(field: TextField, range: Range | null): void {
  field.focus();
  if (!range) return;
  try {
    field.setSelectionRange(range.start, range.end);
  } catch {
    /* not every input keeps a range */
  }
}

function replaceRange(field: TextField, range: Range, text: string): void {
  const next = field.value.slice(0, range.start) + text + field.value.slice(range.end);
  const prototype =
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(field, next);
  else field.value = next;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = range.start + text.length;
  focusField(field, { start: caret, end: caret });
}

function selectAllIn(field: TextField): void {
  field.focus();
  field.select();
}

function copyFrom(field: TextField, text: string): void {
  const range = rangeOf(field);
  focusField(field, range);
  void copyText(text);
}

/* ---- editable regions -------------------------------------------------- */

function editableMenu(host: HTMLElement): MenuEntry[] {
  const selected = window.getSelection()?.toString() ?? '';
  const readable = canReadClipboard();

  return [
    {
      label: 'Cut',
      hint: 'Ctrl+X',
      disabled: !selected,
      onSelect: () => {
        void copyText(selected).then(() => {
          host.focus();
          document.execCommand('delete');
        });
      },
    },
    { label: 'Copy', hint: 'Ctrl+C', disabled: !selected, onSelect: () => void copyText(selected) },
    {
      label: 'Paste',
      hint: readable ? 'Ctrl+V' : 'press Ctrl+V',
      disabled: !readable,
      onSelect: () => {
        void readClipboard().then((text) => {
          if (!text) return;
          host.focus();
          document.execCommand('insertText', false, text);
        });
      },
    },
    separator,
    { label: 'Select all', hint: 'Ctrl+A', onSelect: () => selectWithin(host) },
  ];
}

/* ---- plain selected text ----------------------------------------------- */

function selectionMenu(element: Element): MenuEntry[] {
  const selected = window.getSelection()?.toString() ?? '';
  // A code block is worth copying whole; ordinary prose is not.
  const block = element.closest('pre');
  const host = block ?? element.closest<HTMLElement>(SELECTION_SCOPES);

  // Nothing selected and nothing worth selecting: right-click does nothing.
  if (!selected && !block) return [];

  return [
    {
      label: selected ? 'Copy' : 'Copy all',
      hint: selected ? 'Ctrl+C' : undefined,
      onSelect: () => void copyText(selected || block?.innerText || ''),
    },
    separator,
    {
      // Scoped to the block of text under the pointer, so this is not the
      // whole-page Ctrl+A and is not advertised as it.
      label: 'Select all',
      disabled: !host,
      onSelect: () => {
        if (host) selectWithin(host);
      },
    },
  ];
}

/** Put the whole of an element's text under the user's selection. */
export function selectWithin(host: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(host);
  selection.addRange(range);
}

/* ---- clipboard --------------------------------------------------------- */

export function canReadClipboard(): boolean {
  return typeof navigator.clipboard?.readText === 'function';
}

/**
 * Copy, falling back to the old command when the async clipboard is missing or
 * blocked — which is the common case on a page served over plain http.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    if (document.execCommand('copy')) return true;
  } catch {
    /* fall through */
  }
  store.reportError('Could not copy — press Ctrl+C instead.');
  return false;
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    store.reportError('Could not read the clipboard — press Ctrl+V instead.');
    return '';
  }
}
