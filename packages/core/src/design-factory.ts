import {
  DESIGN_FORMAT_VERSION,
  DesignDocumentSchema,
  DEVICE_FRAMES,
  ScreenDesignSchema,
  type DesignDocument,
  type DesignSystem,
  type Device,
  type ScreenDesign,
} from './design.js';
import { normalizeHtml } from './design-html.js';
import { newId, nowIso } from './ids.js';

/**
 * Building the parts of a design document.
 *
 * The tokens a project starts with, the stylesheet they compile to, and the
 * empty screen a new artboard begins as. Markup itself is built by whoever is
 * writing it — that is rather the point — so what is left here is the frame
 * around it.
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
  html?: string;
  css?: string;
  order?: number;
  notes?: string;
}

/** The empty page a new screen starts as: a padded column, ready to fill. */
export function emptyScreenHtml(): string {
  return '<main class="screen"></main>';
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
    html: normalizeHtml(input.html ?? emptyScreenHtml()).html,
    css: input.css ?? '',
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
  css?: string;
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
    css: input.css ?? DEFAULT_DESIGN_CSS,
    screens: input.screens ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

/* ------------------------------------------------------------------ *
 * Tokens, as CSS
 * ------------------------------------------------------------------ */

/**
 * A token name as a CSS custom-property suffix.
 *
 * `heading.lg` cannot be one — a dot is not valid in an identifier — so it
 * becomes `heading-lg`. The names are the contract between a screen and the
 * tokens panel, so this has to be the only place the translation happens.
 */
export function tokenSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The design system as the stylesheet every screen is drawn against.
 *
 * This is the bridge that keeps the tokens worth having. A screen says
 * `var(--color-accent)` and `class="text-heading-lg"`; changing what those mean
 * in the panel restyles twenty screens at once, exactly as it did when elements
 * pointed at token names in a typed tree.
 *
 * Typography comes out as classes rather than variables because a type token is
 * five properties — size, weight, line height, tracking, casing — and no CSS
 * variable holds five properties usefully.
 */
export function systemToCss(system: DesignSystem): string {
  const lines: string[] = [':root {'];

  for (const color of system.colors) {
    lines.push(`  --color-${tokenSlug(color.name)}: ${color.value};`);
    if (color.on) lines.push(`  --on-${tokenSlug(color.name)}: ${color.on};`);
  }
  lines.push(`  --space: ${system.spacingBase}px;`);
  for (const radius of system.radii) lines.push(`  --radius-${tokenSlug(radius.name)}: ${radius.value};`);
  for (const shadow of system.shadows) lines.push(`  --shadow-${tokenSlug(shadow.name)}: ${shadow.value};`);
  lines.push('}', '');

  for (const type of system.typography) {
    const parts = [
      `font-size: ${type.size}px;`,
      `font-weight: ${type.weight};`,
      `line-height: ${type.lineHeight};`,
    ];
    if (type.family) parts.push(`font-family: ${type.family};`);
    if (type.letterSpacing) parts.push(`letter-spacing: ${type.letterSpacing}px;`);
    if (type.transform !== 'none') parts.push(`text-transform: ${type.transform};`);
    lines.push(`.text-${tokenSlug(type.name)} { ${parts.join(' ')} }`);
  }

  return lines.join('\n');
}

/**
 * The stylesheet a new design starts with.
 *
 * A reset plus enough opinion that plain semantic markup already looks like a
 * product: a `<button>` looks like a button, a `<table>` looks like a table, a
 * `<label>` sits above its field. That is the whole point of the move to HTML —
 * the model writes `<button class="primary">Add patient</button>` and it comes
 * out looking deliberate without a stylesheet per screen.
 *
 * It is meant to be edited. Everything here is written against the tokens, so
 * changing the accent in the panel changes every button.
 */
export const DEFAULT_DESIGN_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px; line-height: 1.55;
  color: var(--color-text); background: var(--color-background);
}
h1, h2, h3, h4, p, figure { margin: 0; }

.screen { display: flex; flex-direction: column; gap: calc(var(--space) * 3); padding: calc(var(--space) * 4); min-height: 100%; }
.row { display: flex; align-items: center; gap: calc(var(--space) * 2); }
.col { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.grow { flex: 1; }
.muted { color: var(--color-subtle); }

header.topbar { display: flex; align-items: center; gap: calc(var(--space) * 2); padding-bottom: calc(var(--space) * 2); border-bottom: 1px solid var(--color-border); }
aside.sidebar { width: 240px; flex: none; display: flex; flex-direction: column; gap: var(--space); padding: calc(var(--space) * 3); background: var(--color-surface); border-right: 1px solid var(--color-border); }
nav { display: flex; gap: calc(var(--space) * 2); }
nav a { color: var(--color-subtle); text-decoration: none; padding: calc(var(--space) * 0.75) var(--space); border-radius: var(--radius-md); }
nav a[aria-current] { color: var(--color-text); background: var(--color-muted); font-weight: 600; }

.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: calc(var(--space) * 2); box-shadow: var(--shadow-sm); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: calc(var(--space) * 2); }

button, .btn { font: inherit; font-weight: 600; padding: calc(var(--space) * 1.25) calc(var(--space) * 2); border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); cursor: default; }
button.primary, .btn.primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--on-accent); }
button.danger, .btn.danger { background: var(--color-danger); border-color: var(--color-danger); color: var(--on-danger); }
button.ghost, .btn.ghost { background: transparent; border-color: transparent; color: var(--color-accent); }
button[disabled] { opacity: 0.5; }

label { display: flex; flex-direction: column; gap: calc(var(--space) * 0.75); font-size: 12px; font-weight: 500; color: var(--color-subtle); }
input, select, textarea { font: inherit; color: var(--color-text); padding: calc(var(--space) * 1.25) calc(var(--space) * 1.5); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); width: 100%; }
input[type="checkbox"], input[type="radio"] { width: auto; }
small { font-size: 12px; color: var(--color-subtle); }

table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 12px; font-weight: 600; color: var(--color-subtle); padding: var(--space) calc(var(--space) * 1.5); border-bottom: 1px solid var(--color-border); }
td { padding: calc(var(--space) * 1.5); border-bottom: 1px solid var(--color-border); }

.badge { display: inline-flex; align-items: center; padding: 2px calc(var(--space)); border-radius: var(--radius-full); background: var(--color-muted); color: var(--on-muted); font-size: 12px; font-weight: 500; }
.badge.success { background: var(--color-success); color: var(--on-success); }
.badge.warning { background: var(--color-warning); color: var(--on-warning); }
.avatar { width: 40px; height: 40px; border-radius: var(--radius-full); background: var(--color-muted); flex: none; }
hr { border: 0; border-top: 1px solid var(--color-border); margin: 0; }

/* An image whose source was a URL: described, never fetched. */
img:not([src]) { display: block; min-height: 120px; border-radius: var(--radius-md); background: linear-gradient(135deg, var(--color-muted), var(--color-border)); }
`.trim();

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
