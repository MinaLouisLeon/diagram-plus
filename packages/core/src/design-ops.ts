import { ELEMENT_CATALOG, isContainer } from './design-catalog.js';
import {
  ARTBOARD_GAP,
  createElement,
  createScreen,
  reidentify,
} from './design-factory.js';
import {
  DesignSystemSchema,
  DEVICE_FRAMES,
  ScreenDesignSchema,
  type DesignDocument,
  type DesignElement,
  type DesignElementInput,
  type DesignLayout,
  type DesignOption,
  type DesignStyle,
  type DesignSystem,
  type Device,
  type ElementType,
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
 * Walking the tree
 * ------------------------------------------------------------------ */

export interface ElementLocation {
  element: DesignElement;
  /** Null when the element is the screen's root. */
  parent: DesignElement | null;
  index: number;
  /** Root-first path to the element, inclusive. */
  path: DesignElement[];
}

/** Depth-first search for an element by id, or by name when that is unique. */
export function findElement(root: DesignElement, ref: string): ElementLocation | null {
  const needle = ref.trim();
  const byId = locate(root, (el) => el.id === needle);
  if (byId) return byId;
  const lower = needle.toLowerCase();
  return locate(root, (el) => el.name.trim().toLowerCase() === lower && lower !== '');
}

function locate(
  root: DesignElement,
  match: (element: DesignElement) => boolean,
): ElementLocation | null {
  if (match(root)) return { element: root, parent: null, index: -1, path: [root] };

  const stack: { element: DesignElement; path: DesignElement[] }[] = [{ element: root, path: [root] }];
  while (stack.length) {
    const { element, path } = stack.pop()!;
    for (let index = 0; index < element.children.length; index++) {
      const child = element.children[index]!;
      const childPath = [...path, child];
      if (match(child)) return { element: child, parent: element, index, path: childPath };
      stack.push({ element: child, path: childPath });
    }
  }
  return null;
}

/** Every element in the tree, root first. */
export function walkElements(root: DesignElement): DesignElement[] {
  const out: DesignElement[] = [];
  const visit = (element: DesignElement): void => {
    out.push(element);
    for (const child of element.children) visit(child);
  };
  visit(root);
  return out;
}

export function countElements(root: DesignElement): number {
  return walkElements(root).length;
}

/** A copy of the tree with one element replaced. Returns null if not found. */
function replaceElement(
  root: DesignElement,
  id: string,
  next: DesignElement,
): DesignElement | null {
  if (root.id === id) return next;
  let hit = false;
  const children = root.children.map((child) => {
    const replaced = replaceElement(child, id, next);
    if (replaced) hit = true;
    return replaced ?? child;
  });
  return hit ? { ...root, children } : null;
}

/** A copy of the tree with one element (and its subtree) taken out. */
function detachElement(
  root: DesignElement,
  id: string,
): { root: DesignElement; removed: DesignElement } | null {
  const found = root.children.findIndex((child) => child.id === id);
  if (found >= 0) {
    const removed = root.children[found]!;
    const children = [...root.children];
    children.splice(found, 1);
    return { root: { ...root, children }, removed };
  }
  for (let i = 0; i < root.children.length; i++) {
    const result = detachElement(root.children[i]!, id);
    if (!result) continue;
    const children = [...root.children];
    children[i] = result.root;
    return { root: { ...root, children }, removed: result.removed };
  }
  return null;
}

/** A copy of the tree with an element inserted under `parentId` at `index`. */
function attachElement(
  root: DesignElement,
  parentId: string,
  index: number,
  element: DesignElement,
): DesignElement | null {
  if (root.id === parentId) {
    const children = [...root.children];
    const at = index < 0 || index > children.length ? children.length : index;
    children.splice(at, 0, element);
    return { ...root, children };
  }
  let hit = false;
  const children = root.children.map((child) => {
    const next = attachElement(child, parentId, index, element);
    if (next) hit = true;
    return next ?? child;
  });
  return hit ? { ...root, children } : null;
}

/** True when `ancestorId` is at or above `id` — a move that would eat itself. */
function contains(root: DesignElement, ancestorId: string, id: string): boolean {
  const found = findElement(root, ancestorId);
  if (!found) return false;
  return walkElements(found.element).some((el) => el.id === id);
}

/* ------------------------------------------------------------------ *
 * Reading a tree written by hand
 * ------------------------------------------------------------------ */

/**
 * Turn loose JSON into a real element tree.
 *
 * This is the door Claude comes through. A model writing a screen supplies
 * types and words, not ids and not a full style block, so ids are minted for
 * anything without one and the catalog's defaults fill the rest — meaning
 * `{ type: 'button', text: 'Sign in' }` arrives as a properly padded, properly
 * coloured button rather than a naked rectangle.
 */
export function hydrateElement(raw: unknown): DesignElement {
  if (!raw || typeof raw !== 'object') {
    throw new Error('An element must be an object with at least a "type".');
  }
  const source = raw as Record<string, unknown>;
  const type = (source['type'] ?? 'frame') as ElementType;
  if (!ELEMENT_CATALOG[type]) {
    throw new Error(
      `"${String(source['type'])}" is not an element type. Call describe_design_schema for the list.`,
    );
  }

  const rawChildren = Array.isArray(source['children']) ? source['children'] : [];
  const children = rawChildren.map(hydrateElement);
  if (children.length && !isContainer(type)) {
    throw new Error(`A ${ELEMENT_CATALOG[type].label.toLowerCase()} cannot hold other elements.`);
  }

  const patch: Partial<DesignElementInput> = { ...(source as Partial<DesignElementInput>) };
  delete patch.children;
  if (typeof patch.id !== 'string' || !patch.id) delete patch.id;

  const element = createElement(type, patch);
  return { ...element, children };
}

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/** Fields of an element that an update may set. Structural ones are excluded. */
export interface ElementPatch {
  name?: string;
  type?: ElementType;
  text?: string;
  label?: string;
  placeholder?: string;
  helper?: string;
  variant?: string;
  icon?: string;
  src?: string;
  alt?: string;
  options?: DesignOption[];
  columns?: string[];
  repeat?: { over?: string; count?: number } | null;
  layout?: Partial<DesignLayout>;
  style?: Partial<DesignStyle>;
  binding?: string;
  action?: string;
  navigatesTo?: string;
  visibleWhen?: string;
  componentId?: string;
  required?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  locked?: boolean;
  notes?: string;
}

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
      root?: unknown;
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
   * Replace a screen's whole element tree. The tool of choice for designing a
   * screen: write it as one nested object rather than forty add_elements.
   */
  | { op: 'set_tree'; screen: string; root: unknown }
  | {
      op: 'add_element';
      screen: string;
      type: ElementType;
      /** Container to put it in. Defaults to the screen's root. */
      parent?: string;
      /** Position among its siblings. Defaults to last. */
      index?: number;
      /** A whole subtree, instead of a single element. */
      children?: unknown[];
      props?: ElementPatch;
    }
  | ({ op: 'update_element'; screen: string; element: string } & ElementPatch)
  | { op: 'remove_element'; screen: string; element: string }
  | { op: 'duplicate_element'; screen: string; element: string }
  | { op: 'move_element'; screen: string; element: string; parent: string; index?: number }
  | { op: 'set_system'; system: Partial<DesignSystem> }
  | { op: 'set_notes'; notes: string };

export interface EditDesignResult {
  document: DesignDocument;
  applied: number;
  errors: { index: number; op: string; message: string }[];
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
  const errors: EditDesignResult['errors'] = [];
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

  const put = (screen: ScreenDesign): void => {
    const at = screens.findIndex((s) => s.id === screen.id);
    const next = { ...screen, updatedAt: nowIso() };
    if (at >= 0) screens[at] = next;
    else screens.push(next);
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

  /** Edit one screen's tree, reporting a missing element consistently. */
  const withTree = (
    ref: string,
    change: (screen: ScreenDesign) => DesignElement,
  ): void => {
    const screen = resolveScreen(ref);
    if (!screen) throw new Error(`No screen matching "${ref}".`);
    put({ ...screen, root: change(screen), edited: true });
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
            root: operation.root === undefined ? undefined : hydrateElement(operation.root),
          });
          const withStates: ScreenDesign = operation.states?.length
            ? { ...screen, states: operation.states }
            : screen;
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
            root: reidentify(screen.root),
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

        case 'set_tree': {
          withTree(operation.screen, () => hydrateElement(operation.root));
          break;
        }

        case 'add_element': {
          const type = operation.type;
          if (!ELEMENT_CATALOG[type]) throw new Error(`"${type}" is not an element type.`);
          withTree(operation.screen, (screen) => {
            const element = hydrateElement({
              ...(operation.props ?? {}),
              type,
              children: operation.children ?? [],
            });
            const parentRef = operation.parent ?? screen.root.id;
            const parent = findElement(screen.root, parentRef);
            if (!parent) throw new Error(`No element matching "${parentRef}" to put it in.`);
            if (!isContainer(parent.element.type)) {
              throw new Error(
                `"${parent.element.name || parent.element.type}" cannot hold other elements.`,
              );
            }
            const next = attachElement(
              screen.root,
              parent.element.id,
              operation.index ?? -1,
              element,
            );
            if (!next) throw new Error(`Could not place the element in "${parentRef}".`);
            return next;
          });
          break;
        }

        case 'update_element': {
          const { op: _op, screen: _ref, element: elementRef, ...patch } = operation;
          withTree(operation.screen, (screen) => {
            const found = findElement(screen.root, elementRef);
            if (!found) throw new Error(`No element matching "${elementRef}".`);
            const current = found.element;

            // A retyped element keeps its words and its children but takes the
            // new type's defaults, which is what "make this a link instead"
            // has to mean if the result is to look like a link.
            const base =
              patch.type && patch.type !== current.type
                ? {
                    ...createElement(patch.type, { id: current.id }),
                    name: current.name,
                    text: current.text,
                    label: current.label,
                    binding: current.binding,
                    action: current.action,
                    navigatesTo: current.navigatesTo,
                    children: isContainer(patch.type) ? current.children : [],
                  }
                : current;

            const next: DesignElement = {
              ...patchOver(base, patch as Partial<DesignElement>),
              id: current.id,
              type: patch.type ?? current.type,
              layout: patch.layout ? patchOver(base.layout, patch.layout) : base.layout,
              style: patch.style ? patchOver(base.style, patch.style) : base.style,
              repeat:
                patch.repeat === undefined
                  ? base.repeat
                  : patch.repeat === null
                    ? null
                    : { over: patch.repeat.over ?? '', count: patch.repeat.count ?? 3 },
              children: base.children,
            };

            const replaced = replaceElement(screen.root, current.id, next);
            if (!replaced) throw new Error(`Could not update "${elementRef}".`);
            return replaced;
          });
          break;
        }

        case 'remove_element': {
          withTree(operation.screen, (screen) => {
            if (screen.root.id === operation.element || screen.root.name === operation.element) {
              throw new Error('The screen itself cannot be removed — use remove_screen.');
            }
            const found = findElement(screen.root, operation.element);
            if (!found) throw new Error(`No element matching "${operation.element}".`);
            const result = detachElement(screen.root, found.element.id);
            if (!result) throw new Error(`Could not remove "${operation.element}".`);
            return result.root;
          });
          break;
        }

        case 'duplicate_element': {
          withTree(operation.screen, (screen) => {
            const found = findElement(screen.root, operation.element);
            if (!found) throw new Error(`No element matching "${operation.element}".`);
            if (!found.parent) throw new Error('The screen itself cannot be duplicated here.');
            const copy = reidentify(found.element);
            const next = attachElement(screen.root, found.parent.id, found.index + 1, copy);
            if (!next) throw new Error(`Could not duplicate "${operation.element}".`);
            return next;
          });
          break;
        }

        case 'move_element': {
          withTree(operation.screen, (screen) => {
            const found = findElement(screen.root, operation.element);
            if (!found) throw new Error(`No element matching "${operation.element}".`);
            if (!found.parent) throw new Error('The screen itself cannot be moved.');
            const parent = findElement(screen.root, operation.parent);
            if (!parent) throw new Error(`No element matching "${operation.parent}".`);
            if (!isContainer(parent.element.type)) {
              throw new Error(
                `"${parent.element.name || parent.element.type}" cannot hold other elements.`,
              );
            }
            if (contains(screen.root, found.element.id, parent.element.id)) {
              throw new Error('An element cannot be moved inside itself.');
            }

            const detached = detachElement(screen.root, found.element.id);
            if (!detached) throw new Error(`Could not move "${operation.element}".`);
            const next = attachElement(
              detached.root,
              parent.element.id,
              operation.index ?? -1,
              detached.removed,
            );
            if (!next) throw new Error(`Could not place "${operation.element}" there.`);
            return next;
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

  return {
    document: applied
      ? { ...document, screens, system, notes, updatedAt: nowIso() }
      : document,
    applied,
    errors,
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

/**
 * Lay the artboards out in reading order, wrapping into rows.
 *
 * An artboard that has been dragged stays where it was put, for the same
 * reason the client view leaves dragged boxes alone: people arrange these
 * while talking over them, and having that undone by the next edit is worse
 * than an imperfect grid.
 */
export function layoutDesign(
  document: DesignDocument,
  options: DesignLayoutOptions = {},
): DesignDocument {
  const { perRow = 4, includePinned = false } = options;
  if (!document.screens.length) return document;

  const ordered = [...document.screens].sort((a, b) => a.order - b.order);
  const rows: ScreenDesign[][] = [];
  for (let i = 0; i < ordered.length; i += perRow) rows.push(ordered.slice(i, i + perRow));

  const placed = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const row of rows) {
    let x = 0;
    for (const screen of row) {
      placed.set(screen.id, { x, y });
      x += screen.frame.width + ARTBOARD_GAP;
    }
    y += Math.max(...row.map((s) => s.frame.height)) + ARTBOARD_GAP;
  }

  return {
    ...document,
    screens: document.screens.map((screen) => {
      if (screen.pinned && !includePinned) return screen;
      const position = placed.get(screen.id);
      if (!position) return screen;
      return { ...screen, position, pinned: includePinned ? false : screen.pinned };
    }),
    updatedAt: nowIso(),
  };
}
