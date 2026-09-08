import { ELEMENT_CATALOG } from './design-catalog.js';
import {
  DESIGN_FORMAT_VERSION,
  DesignDocumentSchema,
  DesignElementSchema,
  DEVICE_FRAMES,
  ScreenDesignSchema,
  type DesignDocument,
  type DesignElement,
  type DesignElementInput,
  type DesignSystem,
  type Device,
  type ElementType,
  type ScreenDesign,
} from './design.js';
import { newId, nowIso } from './ids.js';

/**
 * Building the parts of a design document.
 *
 * Every element that reaches the tree comes through `createElement`, so a box
 * dragged off the palette and a box written by Claude start life identical —
 * the same defaults, the same tokens, the same shape. That is what stops the
 * editor and the MCP server drifting into two dialects of the same format.
 */

/* ------------------------------------------------------------------ *
 * A design system to start from
 * ------------------------------------------------------------------ */

/**
 * The tokens a new design gets.
 *
 * Neutral on purpose: greys, one blue, a type scale that reads. It is a
 * starting point that already looks deliberate, so the first screen drawn
 * against it is not a pile of browser defaults — and it is meant to be
 * replaced, either by the user in the tokens panel or by Claude in one
 * `set_design_system` call.
 *
 * The names matter more than the values. Elements refer to `accent`,
 * `surface`, `heading.lg`; swapping what those mean restyles every screen at
 * once, which is the whole reason designs point at tokens instead of colours.
 */
export const DEFAULT_DESIGN_SYSTEM: DesignSystem = {
  name: 'Default',
  voice: 'Clear and unfussy. Generous spacing, one accent colour, no decoration that is not doing work.',
  colors: [
    { name: 'background', value: '#f8fafc', on: '#0f172a', description: 'The page behind everything.' },
    { name: 'surface', value: '#ffffff', on: '#0f172a', description: 'Cards, fields, bars.' },
    { name: 'text', value: '#0f172a', on: '', description: 'Body copy and headings.' },
    { name: 'muted', value: '#e2e8f0', on: '#475569', description: 'Placeholders and quiet fills.' },
    { name: 'subtle', value: '#64748b', on: '', description: 'Secondary text.' },
    { name: 'border', value: '#cbd5e1', on: '', description: 'Hairlines and field outlines.' },
    { name: 'accent', value: '#2563eb', on: '#ffffff', description: 'The one colour that means "do this".' },
    { name: 'on-accent', value: '#ffffff', on: '', description: 'Text on top of the accent.' },
    { name: 'success', value: '#16a34a', on: '#ffffff', description: 'It worked.' },
    { name: 'warning', value: '#d97706', on: '#ffffff', description: 'Careful.' },
    { name: 'danger', value: '#dc2626', on: '#ffffff', description: 'It failed, or it destroys something.' },
  ],
  typography: [
    { name: 'display', family: '', size: 40, weight: 700, lineHeight: 1.15, letterSpacing: -0.5, transform: 'none', description: 'Hero titles only.' },
    { name: 'heading.lg', family: '', size: 28, weight: 600, lineHeight: 1.25, letterSpacing: -0.2, transform: 'none', description: 'The name of a screen.' },
    { name: 'heading.md', family: '', size: 20, weight: 600, lineHeight: 1.3, letterSpacing: 0, transform: 'none', description: 'A section within a screen.' },
    { name: 'heading.sm', family: '', size: 16, weight: 600, lineHeight: 1.4, letterSpacing: 0, transform: 'none', description: 'A card title, a field group.' },
    { name: 'body.md', family: '', size: 15, weight: 400, lineHeight: 1.55, letterSpacing: 0, transform: 'none', description: 'Default copy.' },
    { name: 'body.sm', family: '', size: 13, weight: 400, lineHeight: 1.5, letterSpacing: 0, transform: 'none', description: 'Dense rows and tables.' },
    { name: 'caption', family: '', size: 12, weight: 500, lineHeight: 1.4, letterSpacing: 0.2, transform: 'none', description: 'Helper lines, badges, metadata.' },
    { name: 'mono', family: 'ui-monospace, SFMono-Regular, monospace', size: 13, weight: 400, lineHeight: 1.5, letterSpacing: 0, transform: 'none', description: 'Codes, IDs, amounts.' },
  ],
  spacingBase: 8,
  radii: [
    { name: 'none', value: '0px', description: 'Square.' },
    { name: 'sm', value: '4px', description: 'Badges and small chips.' },
    { name: 'md', value: '8px', description: 'Buttons, fields, cards.' },
    { name: 'lg', value: '16px', description: 'Dialogs and large panels.' },
    { name: 'full', value: '9999px', description: 'Pills and avatars.' },
  ],
  shadows: [
    { name: 'sm', value: '0 1px 2px rgba(15, 23, 42, 0.06)', description: 'A card lifting off the page.' },
    { name: 'md', value: '0 4px 12px rgba(15, 23, 42, 0.10)', description: 'Menus and popovers.' },
    { name: 'lg', value: '0 16px 40px rgba(15, 23, 42, 0.18)', description: 'Dialogs.' },
  ],
  notes: '',
};

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

/** Deep-merge a patch over a defaults object, one level into nested objects. */
function mergeInput(
  base: Omit<DesignElementInput, 'id'>,
  patch: Partial<DesignElementInput>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = out[key];
    const bothPlainObjects =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing);
    out[key] = bothPlainObjects
      ? { ...(existing as object), ...(value as object) }
      : value;
  }
  return out;
}

/**
 * A new element of a type, with the catalog's defaults filled in.
 *
 * The patch wins over the defaults, and `layout`/`style` merge rather than
 * replace — so asking for a red button does not also throw away its padding.
 */
export function createElement(
  type: ElementType,
  patch: Partial<DesignElementInput> = {},
): DesignElement {
  const info = ELEMENT_CATALOG[type];
  const merged = mergeInput(info.defaults, patch);
  return DesignElementSchema.parse({
    ...merged,
    id: (patch.id as string | undefined) ?? newId('els'),
    type,
  } as DesignElementInput);
}

/** Give every element in a tree a fresh id — for duplicating a subtree. */
export function reidentify(element: DesignElement): DesignElement {
  return {
    ...element,
    id: newId('els'),
    children: element.children.map(reidentify),
  };
}

/* ------------------------------------------------------------------ *
 * Screens
 * ------------------------------------------------------------------ */

export interface CreateScreenInput {
  name: string;
  blockId?: string | null;
  variant?: string;
  route?: string;
  purpose?: string;
  device?: Device;
  frame?: { width: number; height: number };
  position?: { x: number; y: number };
  background?: string;
  root?: DesignElement;
  order?: number;
  notes?: string;
}

/** The empty page a new screen starts as: a padded column, ready to fill. */
export function emptyScreenRoot(): DesignElement {
  return createElement('stack', {
    name: 'Screen',
    layout: {
      direction: 'column',
      gap: 24,
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      width: 'fill',
      height: 'fill',
    },
  });
}

export function createScreen(input: CreateScreenInput): ScreenDesign {
  const device = input.device ?? 'desktop';
  const preset = DEVICE_FRAMES[device];
  return ScreenDesignSchema.parse({
    id: newId('scr'),
    blockId: input.blockId ?? null,
    name: input.name,
    variant: input.variant ?? '',
    route: input.route ?? '',
    purpose: input.purpose ?? '',
    device,
    frame: input.frame ?? { width: preset.width, height: preset.height },
    position: input.position ?? { x: 0, y: 0 },
    background: input.background ?? 'background',
    root: input.root ?? emptyScreenRoot(),
    order: input.order ?? 0,
    notes: input.notes ?? '',
    updatedAt: nowIso(),
  });
}

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

export interface CreateDesignInput {
  slug: string;
  name?: string;
  diagramId?: string;
  system?: Partial<DesignSystem>;
  screens?: ScreenDesign[];
}

export function createDesignDocument(input: CreateDesignInput): DesignDocument {
  const now = nowIso();
  return DesignDocumentSchema.parse({
    formatVersion: DESIGN_FORMAT_VERSION,
    diagramId: input.diagramId ?? '',
    slug: input.slug,
    name: input.name ?? '',
    revision: 0,
    system: { ...DEFAULT_DESIGN_SYSTEM, ...(input.system ?? {}) },
    screens: input.screens ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Artboard spacing on the design canvas — one gutter, used everywhere. */
export const ARTBOARD_GAP = 120;

/**
 * The title strip above an artboard, in canvas pixels.
 *
 * It sits above `position.y` in the flow, so an artboard is taller than its
 * frame. Layout has to reserve it or two rows of screens touch — and the
 * canvas is the one thing the user shows a client, so "nearly clear" is not
 * good enough.
 */
export const ARTBOARD_BAR = 28;
