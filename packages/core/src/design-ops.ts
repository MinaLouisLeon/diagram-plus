import { ARTBOARD_BAR, ARTBOARD_GAP, createScreen } from './design-factory.js';
import {
  EL_ID,
  findHtml,
  getAttr,
  hasAttr,
  normalizeHtml,
  ownTextOf,
  parentOf,
  parseHtml,
  removeAttr,
  reidentifyHtml,
  sanitizeCss,
  serializeHtml,
  serializeOuterHtml,
  setAttr,
  textOf,
  walkHtml,
  type HtmlElement,
  type HtmlFragment,
} from './design-html.js';
import {
  DesignSystemSchema,
  DEVICE_FRAMES,
  ScreenDesignSchema,
  type DesignDocument,
  type DesignSystem,
  type Device,
  type ScreenDesign,
  type ScreenState,
  type ScreenStatus,
} from './design.js';
import { nowIso } from './ids.js';

/**
 * Editing a design.
 *
 * One vocabulary of operations, used by the canvas, by the REST API and by the
 * MCP tools — so a button dragged into place during a review and a button
 * added by Claude between two messages are the same change arriving by
 * different roads. It is the same bargain `editClientView` makes, and it is
 * what keeps a document edited from both ends coherent.
 *
 * Nothing here throws for a bad operation. Each one is tried, and the ones
 * that fail come back as errors alongside the ones that worked, because a
 * batch of twenty edits from a model should not be lost to one bad reference.
 */

/* ------------------------------------------------------------------ *
 * Walking a screen
 * ------------------------------------------------------------------ */

/**
 * Every element on a screen, outermost first.
 *
 * The tree had `walkElements`; this is the same idea over markup, and the
 * handful of things that used it — counting a design, finding the buttons that
 * do nothing — work the same way against the same shape.
 */
export function walkScreen(html: string): HtmlElement[] {
  return walkHtml(parseHtml(html));
}

export function countElements(html: string): number {
  return walkScreen(html).length;
}

/** Read one element and everything it declares, without the caller parsing. */
export interface ElementFacts {
  id: string;
  tag: string;
  /** What to call it in a message: its name, its words, or its tag. */
  label: string;
  text: string;
  classes: string[];
  binding: string;
  action: string;
  navigatesTo: string;
  component: string;
  visibleWhen: string;
  repeat: { over: string; count: number } | null;
  required: boolean;
  disabled: boolean;
  hidden: boolean;
}

export function factsOf(element: HtmlElement): ElementFacts {
  const repeatOver = getAttr(element, 'data-repeat');
  const name = getAttr(element, 'data-name');
  // Its own words, not its descendants'. A container falling back to
  // everything underneath it turns an outline into a wall of repeated text —
  // only something with nothing nested inside it can borrow its children's.
  const leaf = !walkHtml(element).length;
  const words = ownTextOf(element) || (leaf ? textOf(element) : '');
  return {
    id: getAttr(element, EL_ID),
    tag: element.tagName.toLowerCase(),
    label: name || words || element.tagName.toLowerCase(),
    text: words,
    classes: getAttr(element, 'class').split(/\s+/).filter(Boolean),
    binding: getAttr(element, 'data-binding'),
    action: getAttr(element, 'data-action'),
    navigatesTo: getAttr(element, 'data-navigates-to'),
    component: getAttr(element, 'data-component'),
    visibleWhen: getAttr(element, 'data-visible-when'),
    repeat: repeatOver
      ? { over: repeatOver, count: Number(getAttr(element, 'data-repeat-count')) || 3 }
      : null,
    required: hasAttr(element, 'required'),
    disabled: hasAttr(element, 'disabled'),
    hidden: hasAttr(element, 'hidden'),
  };
}

/** True when `ancestor` is at or above `id` — a move that would eat itself. */
function containsNode(ancestor: HtmlElement, id: string): boolean {
  return walkHtml(ancestor).some((el) => getAttr(el, EL_ID) === id);
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

export interface ScreenPatch {
  name?: string;
  variant?: string;
  route?: string;
  purpose?: string;
  device?: Device;
  frame?: { width?: number; height?: number };
  position?: { x: number; y: number };
  background?: string;
  states?: ScreenState[];
  status?: ScreenStatus;
  blockId?: string | null;
  notes?: string;
}

export type DesignOperation =
  /** Add an artboard. `root` may carry a whole tree written in one go. */
  | {
      op: 'add_screen';
      name: string;
      blockId?: string | null;
      variant?: string;
      route?: string;
      purpose?: string;
      device?: Device;
      background?: string;
      html?: string;
      css?: string;
      states?: ScreenState[];
      /** Place it after this screen in the walkthrough, by id or name. */
      after?: string;
    }
  | ({ op: 'update_screen'; screen: string } & ScreenPatch)
  | { op: 'remove_screen'; screen: string }
  | { op: 'duplicate_screen'; screen: string; name?: string; variant?: string }
  | { op: 'move_screen'; screen: string; x: number; y: number }
  /** The whole walkthrough order, by id or name; anything left out keeps its place at the end. */
  | { op: 'reorder_screens'; order: string[] }
  /**
   * Replace a screen's markup. The tool of choice for designing a screen:
   * write the whole thing at once rather than thirty small edits.
   */
  | { op: 'set_html'; screen: string; html: string }
  /** Replace a screen's own CSS. Omit `screen` for the shared stylesheet. */
  | { op: 'set_css'; screen?: string; css: string }
  /** Put markup inside, before or after an element. */
  | {
      op: 'insert_html';
      screen: string;
      html: string;
      /** Element to place it against, by `data-el`. Defaults to the outermost. */
      target?: string;
      where?: 'inside' | 'before' | 'after';
      /** Position among the target's children, for `inside`. Defaults to last. */
      index?: number;
    }
  /** Set or clear one attribute — `data-binding`, `class`, `placeholder`. */
  | { op: 'set_attribute'; screen: string; element: string; name: string; value: string | null }
  /** Replace the words on an element, leaving anything nested inside it alone. */
  | { op: 'set_text'; screen: string; element: string; text: string }
  | { op: 'move_node'; screen: string; element: string; parent: string; index?: number }
  | { op: 'remove_node'; screen: string; element: string }
  | { op: 'duplicate_node'; screen: string; element: string }
  | { op: 'set_system'; system: Partial<DesignSystem> }
  | { op: 'set_notes'; notes: string };

export interface EditDesignResult {
  document: DesignDocument;
  applied: number;
  errors: { index: number; op: string; message: string }[];
  /**
   * What was quietly put right on the way in: elements pulled back into the
   * flow, artboards moved off each other. Not errors — the edit was applied —
   * but the caller has to be told, or a model repeats the same mistake on the
   * next nineteen screens and nobody finds out until the client does.
   */
  corrections: string[];
}

/** Merge a partial over an object, ignoring undefined. */
function patchOver<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

export function editDesign(
  document: DesignDocument,
  operations: DesignOperation[],
): EditDesignResult {
  let screens = [...document.screens];
  let system = document.system;
  let notes = document.notes;
  let documentCss = document.css;
  const errors: EditDesignResult['errors'] = [];
  const loose: string[] = [];
  let applied = 0;

  /** Resolve a screen by id, by "Name" or by "Name / Variant". */
  const resolveScreen = (ref: string): ScreenDesign | undefined => {
    const needle = ref.trim();
    const lower = needle.toLowerCase();
    return (
      screens.find((s) => s.id === needle) ??
      screens.find((s) => `${s.name} / ${s.variant}`.toLowerCase() === lower) ??
      screens.find((s) => s.name.toLowerCase() === lower && !s.variant) ??
      screens.find((s) => s.name.toLowerCase() === lower) ??
      screens.find((s) => s.blockId === needle) ??
      screens.find((s) => s.route && s.route.toLowerCase() === lower)
    );
  };

  /**
   * Nothing reaches the document without being sanitised and identified.
   *
   * The typed tree had `hydrateElement` as its one door in; this is the same
   * bargain for markup. Whatever came in, what lands is safe to render and has
   * a `data-el` on everything, so the canvas can address it.
   */
  const settle = (screen: ScreenDesign): ScreenDesign => {
    const { html, removed } = normalizeHtml(screen.html);
    const css = sanitizeCss(screen.css);
    if (removed.length || css.removed.length) {
      loose.push(
        ...[...removed, ...css.removed].map((what) => `${screen.name || screen.id} → ${what}`),
      );
    }
    return { ...screen, html, css: css.css };
  };

  const put = (screen: ScreenDesign): void => {
    const at = screens.findIndex((s) => s.id === screen.id);
    const next = { ...settle(screen), updatedAt: nowIso() };
    if (at >= 0) screens[at] = next;
    else screens.push(next);
  };

  /**
   * Edit one screen's markup, reporting a missing screen consistently.
   *
   * The document is parsed, changed and written back on every operation. That
   * is more work than mutating a tree in place, and it is the price of the
   * format being text — but a batch of twenty edits is twenty small parses of
   * one screen, which is nothing next to rendering it.
   */
  const withHtml = (
    ref: string,
    change: (fragment: HtmlFragment, screen: ScreenDesign) => void,
  ): void => {
    const screen = resolveScreen(ref);
    if (!screen) throw new Error(`No screen matching "${ref}".`);
    const fragment = parseHtml(screen.html);
    change(fragment, screen);
    put({ ...screen, html: serializeHtml(fragment), edited: true });
  };

  /** Resolve an element on a screen, or say so plainly. */
  const nodeOf = (fragment: HtmlFragment, ref: string): HtmlElement => {
    const found = findHtml(fragment, ref);
    if (!found) throw new Error(`No element matching "${ref}" on that screen.`);
    return found;
  };

  /** Where a new artboard goes: to the right of the last one. */
  const nextArtboardPosition = (width: number): { x: number; y: number } => {
    if (!screens.length) return { x: 0, y: 0 };
    const right = Math.max(...screens.map((s) => s.position.x + s.frame.width));
    const top = Math.min(...screens.map((s) => s.position.y));
    void width;
    return { x: right + ARTBOARD_GAP, y: top };
  };

  const renumber = (): void => {
    screens = screens.map((screen, index) => ({ ...screen, order: index }));
  };

  operations.forEach((operation, index) => {
    try {
      switch (operation.op) {
        case 'add_screen': {
          const name = operation.name.trim();
          if (!name) throw new Error('A screen needs a name.');
          const device = operation.device ?? 'desktop';
          const preset = DEVICE_FRAMES[device];
          const screen = createScreen({
            name,
            blockId: operation.blockId ?? null,
            variant: operation.variant ?? '',
            route: operation.route ?? '',
            purpose: operation.purpose ?? '',
            device,
            background: operation.background ?? 'background',
            position: nextArtboardPosition(preset.width),
            html: operation.html,
            css: operation.css,
          });
          const withStates: ScreenDesign = settle(
            operation.states?.length ? { ...screen, states: operation.states } : screen,
          );
          const after = operation.after ? resolveScreen(operation.after) : undefined;
          if (after) screens.splice(screens.indexOf(after) + 1, 0, withStates);
          else screens.push(withStates);
          renumber();
          break;
        }

        case 'update_screen': {
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          const { op: _op, screen: _ref, ...patch } = operation;
          const next: ScreenDesign = { ...screen };

          if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
          if (patch.variant !== undefined) next.variant = patch.variant;
          if (patch.route !== undefined) next.route = patch.route;
          if (patch.purpose !== undefined) next.purpose = patch.purpose;
          if (patch.background !== undefined) next.background = patch.background;
          if (patch.states !== undefined) next.states = patch.states;
          if (patch.status !== undefined) next.status = patch.status;
          if (patch.blockId !== undefined) next.blockId = patch.blockId;
          if (patch.notes !== undefined) next.notes = patch.notes;
          if (patch.position !== undefined) {
            next.position = patch.position;
            next.pinned = true;
          }
          // Changing the device resizes the frame unless a size was given too,
          // which is what someone means by "make this the mobile one".
          if (patch.device !== undefined) {
            next.device = patch.device;
            const preset = DEVICE_FRAMES[patch.device];
            next.frame = { width: preset.width, height: preset.height };
          }
          if (patch.frame !== undefined) {
            next.frame = {
              width: patch.frame.width ?? next.frame.width,
              height: patch.frame.height ?? next.frame.height,
            };
            next.device = 'custom';
          }
          put({ ...ScreenDesignSchema.parse(next), edited: true });
          break;
        }

        case 'remove_screen': {
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          screens = screens.filter((s) => s.id !== screen.id);
          renumber();
          break;
        }

        case 'duplicate_screen': {
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          const copy = createScreen({
            name: operation.name ?? screen.name,
            blockId: screen.blockId,
            variant: operation.variant ?? (screen.variant ? `${screen.variant} copy` : 'Copy'),
            route: screen.route,
            purpose: screen.purpose,
            device: screen.device,
            frame: screen.frame,
            background: screen.background,
            position: nextArtboardPosition(screen.frame.width),
            // Fresh ids throughout, so selecting something on the copy never
            // reaches back into the screen it was copied from.
            html: reidentifyHtml(screen.html),
            css: screen.css,
          });
          screens.splice(screens.indexOf(screen) + 1, 0, { ...copy, states: screen.states });
          renumber();
          break;
        }

        case 'move_screen': {
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          put({
            ...screen,
            position: { x: Math.round(operation.x), y: Math.round(operation.y) },
            pinned: true,
          });
          break;
        }

        case 'reorder_screens': {
          const seen = new Set<string>();
          const ordered: ScreenDesign[] = [];
          for (const ref of operation.order) {
            const screen = resolveScreen(ref);
            if (!screen || seen.has(screen.id)) continue;
            seen.add(screen.id);
            ordered.push(screen);
          }
          screens = [...ordered, ...screens.filter((s) => !seen.has(s.id))];
          renumber();
          break;
        }

        case 'set_html': {
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          put({ ...screen, html: operation.html, edited: true });
          break;
        }

        case 'set_css': {
          if (!operation.screen) {
            const cleaned = sanitizeCss(operation.css);
            if (cleaned.removed.length) {
              loose.push(...cleaned.removed.map((what) => `the shared stylesheet → ${what}`));
            }
            documentCss = cleaned.css;
            break;
          }
          const screen = resolveScreen(operation.screen);
          if (!screen) throw new Error(`No screen matching "${operation.screen}".`);
          put({ ...screen, css: operation.css, edited: true });
          break;
        }

        case 'insert_html': {
          const where = operation.where ?? 'inside';
          withHtml(operation.screen, (fragment) => {
            const added = parseHtml(normalizeHtml(operation.html).html);
            const moved = [...added.childNodes];
            if (!moved.length) throw new Error('There was no markup to insert.');

            // Without a target the markup joins the screen's outermost element,
            // which is what "add this to the screen" nearly always means.
            const outermost = walkHtml(fragment)[0];
            const target = operation.target ? nodeOf(fragment, operation.target) : outermost;
            if (!target) throw new Error('That screen has nothing to insert against yet.');

            const parent = where === 'inside' ? target : parentOf(target);
            if (!parent) throw new Error('That element has nothing around it to insert into.');

            const siblings = parent.childNodes;
            const at =
              where === 'inside'
                ? operation.index === undefined || operation.index < 0
                  ? siblings.length
                  : Math.min(operation.index, siblings.length)
                : siblings.indexOf(target) + (where === 'after' ? 1 : 0);

            for (const node of moved) node.parentNode = parent;
            siblings.splice(at, 0, ...(moved as typeof siblings));
          });
          break;
        }

        case 'set_attribute': {
          withHtml(operation.screen, (fragment) => {
            const node = nodeOf(fragment, operation.element);
            if (operation.name === EL_ID) {
              throw new Error(`"${EL_ID}" is how the editor addresses an element; it cannot be set.`);
            }
            if (operation.value === null) removeAttr(node, operation.name);
            else setAttr(node, operation.name, operation.value);
          });
          break;
        }

        case 'set_text': {
          withHtml(operation.screen, (fragment) => {
            const node = nodeOf(fragment, operation.element);
            // Only the words directly on it go. Anything nested inside stays
            // where it is, so retitling a card does not empty the card.
            const kept = node.childNodes.filter((child) => child.nodeName !== '#text');
            const text = { nodeName: '#text', value: operation.text, parentNode: node } as never;
            node.childNodes = operation.text ? [text, ...kept] : kept;
          });
          break;
        }

        case 'move_node': {
          withHtml(operation.screen, (fragment) => {
            const node = nodeOf(fragment, operation.element);
            const parent = nodeOf(fragment, operation.parent);
            if (node === parent || containsNode(node, getAttr(parent, EL_ID))) {
              throw new Error('An element cannot be moved inside itself.');
            }
            const from = parentOf(node);
            if (!from) throw new Error('The outermost element of a screen cannot be moved.');

            from.childNodes.splice(from.childNodes.indexOf(node), 1);
            const at =
              operation.index === undefined || operation.index < 0
                ? parent.childNodes.length
                : Math.min(operation.index, parent.childNodes.length);
            node.parentNode = parent;
            parent.childNodes.splice(at, 0, node);
          });
          break;
        }

        case 'remove_node': {
          withHtml(operation.screen, (fragment) => {
            const node = nodeOf(fragment, operation.element);
            const parent = parentOf(node);
            if (!parent) {
              throw new Error(
                'That is the outermost element of the screen — use remove_screen, or set_html to replace it.',
              );
            }
            parent.childNodes.splice(parent.childNodes.indexOf(node), 1);
          });
          break;
        }

        case 'duplicate_node': {
          withHtml(operation.screen, (fragment) => {
            const node = nodeOf(fragment, operation.element);
            const parent = parentOf(node);
            if (!parent) throw new Error('The outermost element of a screen cannot be duplicated.');

            const copy = parseHtml(reidentifyHtml(serializeOuterHtml(node)));
            const made = [...copy.childNodes];
            for (const child of made) child.parentNode = parent;
            parent.childNodes.splice(parent.childNodes.indexOf(node) + 1, 0, ...(made as never[]));
          });
          break;
        }

        case 'set_system': {
          system = DesignSystemSchema.parse({ ...system, ...operation.system });
          break;
        }

        case 'set_notes': {
          notes = operation.notes;
          break;
        }

        default: {
          const unknown = operation as { op?: string };
          throw new Error(`Unknown operation "${unknown.op}".`);
        }
      }
      applied += 1;
    } catch (err) {
      errors.push({
        index,
        op: (operation as { op: string }).op,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (!applied) return { document, applied, errors, corrections: [] };

  // Last, and unconditionally: a batch that resized a frame or swapped a
  // device has just changed how much room an artboard takes, and whoever asked
  // for it cannot see the canvas.
  const relaxed = relaxArtboards(screens);

  const corrections: string[] = [];
  if (loose.length) {
    corrections.push(
      `${loose.length} element(s) were placed at x/y outside a frame and have been settled back ` +
        `into the flow of their container: ${loose.slice(0, 8).join(', ')}` +
        `${loose.length > 8 ? ', …' : ''}. Nest stacks and set gap/padding instead — guessed ` +
        'coordinates land elements on top of each other.',
    );
  }
  if (relaxed.moved.length) {
    corrections.push(
      `${relaxed.moved.length} artboard(s) would have overlapped and were moved clear: ` +
        `${relaxed.moved.slice(0, 8).join(', ')}${relaxed.moved.length > 8 ? ', …' : ''}. ` +
        'Run arrange_screen_designs if you want the canvas tidied into an even grid.',
    );
  }

  return {
    document: {
      ...document,
      screens: relaxed.screens,
      system,
      css: documentCss,
      notes,
      updatedAt: nowIso(),
    },
    applied,
    errors,
    corrections,
  };
}

/* ------------------------------------------------------------------ *
 * Arranging the canvas
 * ------------------------------------------------------------------ */

export interface DesignLayoutOptions {
  /** Artboards per row before wrapping. */
  perRow?: number;
  /** Move even the artboards somebody dragged. */
  includePinned?: boolean;
}

/** The space an artboard actually occupies: its frame plus its title strip. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(screen: ScreenDesign): Rect {
  return {
    x: screen.position.x,
    y: screen.position.y,
    width: screen.frame.width,
    height: screen.frame.height + ARTBOARD_BAR,
  };
}

/** Do two artboards touch, once the gutter between them is counted? */
function collides(a: Rect, b: Rect, gap = ARTBOARD_GAP): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * Lay the artboards out in reading order, wrapping into rows.
 *
 * Columns share one pitch — the widest artboard in the document — so the
 * canvas reads as a contact sheet rather than a ragged row, which is what it
 * has to be when somebody walks a client through it.
 *
 * An artboard that has been dragged stays where it was put, for the same
 * reason the client view leaves dragged boxes alone: people arrange these
 * while talking over them, and having that undone by the next edit is worse
 * than an imperfect grid. The grid flows *around* those rather than reserving
 * them a slot it will not use — a pinned artboard used to leave both a hole in
 * the grid and itself sitting on top of whatever was under it.
 */
export function layoutDesign(
  document: DesignDocument,
  options: DesignLayoutOptions = {},
): DesignDocument {
  const { perRow = 4, includePinned = false } = options;
  if (!document.screens.length) return document;

  const ordered = [...document.screens].sort((a, b) => a.order - b.order);
  const moving = includePinned ? ordered : ordered.filter((s) => !s.pinned);
  if (!moving.length) return document;

  // One pitch for every column and every row, taken from the largest artboard
  // there is: mixed device sizes otherwise stagger the grid, and a screen
  // resized later then lands on its neighbour.
  const columnPitch = Math.max(...ordered.map((s) => s.frame.width)) + ARTBOARD_GAP;
  const rowPitch = Math.max(...ordered.map((s) => s.frame.height)) + ARTBOARD_BAR + ARTBOARD_GAP;

  const fixed = includePinned ? [] : ordered.filter((s) => s.pinned).map(rectOf);
  const placed = new Map<string, { x: number; y: number }>();

  let slot = 0;
  for (const screen of moving) {
    // Walk on past any slot a pinned artboard is already sitting in.
    let position = { x: (slot % perRow) * columnPitch, y: Math.floor(slot / perRow) * rowPitch };
    while (
      fixed.some((rect) =>
        collides({ ...position, width: screen.frame.width, height: screen.frame.height + ARTBOARD_BAR }, rect),
      )
    ) {
      slot += 1;
      position = { x: (slot % perRow) * columnPitch, y: Math.floor(slot / perRow) * rowPitch };
    }
    placed.set(screen.id, position);
    slot += 1;
  }

  return {
    ...document,
    screens: document.screens.map((screen) => {
      const position = placed.get(screen.id);
      if (!position) return screen;
      return { ...screen, position, pinned: includePinned ? false : screen.pinned };
    }),
    updatedAt: nowIso(),
  };
}

/**
 * Pull overlapping artboards apart, moving as little as possible.
 *
 * This is the invariant the design canvas lives or dies by: two screens drawn
 * on top of each other are not a design anybody can show a client, and it is
 * the one failure that is invisible to whoever caused it — a model changing a
 * screen's device from `desktop` to `wide` grows its frame by 480px and has no
 * idea it just buried the screen beside it.
 *
 * So rather than asking every caller to remember to re-tidy, `editDesign` runs
 * this after every batch. Artboards are swept in reading order and a screen
 * that lands on an earlier one is pushed to the right until it clears, which
 * keeps the walkthrough order intact — the alternative, moving the screen that
 * grew, would silently reorder the story. Pinned artboards are obstacles and
 * never move: where a person put a screen is a decision, not a suggestion.
 */
export function relaxArtboards(screens: ScreenDesign[]): {
  screens: ScreenDesign[];
  moved: string[];
} {
  if (screens.length < 2) return { screens, moved: [] };

  const order = [...screens].sort((a, b) => a.order - b.order);
  const settled: Rect[] = order.filter((s) => s.pinned).map(rectOf);
  const positions = new Map<string, { x: number; y: number }>();
  const moved: string[] = [];

  for (const screen of order) {
    if (screen.pinned) continue;
    const rect = rectOf(screen);

    // Step right past whatever is in the way, re-checking from the start each
    // time: clearing one neighbour can land the artboard on the next.
    let guard = 0;
    for (;;) {
      const hit = settled.find((other) => collides(rect, other));
      if (!hit || guard++ > screens.length * 2) break;
      rect.x = hit.x + hit.width + ARTBOARD_GAP;
    }

    if (rect.x !== screen.position.x || rect.y !== screen.position.y) {
      positions.set(screen.id, { x: Math.round(rect.x), y: Math.round(rect.y) });
      moved.push(screen.name || screen.id);
    }
    settled.push(rect);
  }

  if (!moved.length) return { screens, moved: [] };
  return {
    screens: screens.map((screen) => {
      const position = positions.get(screen.id);
      return position ? { ...screen, position } : screen;
    }),
    moved,
  };
}
