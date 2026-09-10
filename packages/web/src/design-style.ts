import type { DesignSystem } from '@diagram-plus/core/browser';
import { tokenSlug } from '@diagram-plus/core/browser';

/**
 * What the properties panel needs to know about a look.
 *
 * The document only records what somebody overrode. Nearly everything a screen
 * looks like comes from the tokens and the shared stylesheet, so a panel that
 * showed only the overrides would be a column of empty boxes over a screen
 * full of deliberate typography. The canvas reads the resolved values back out
 * of the iframe instead, and they are what the panel shows until you change
 * one — which is the difference between a form and a design tool.
 */

/**
 * The properties read back off the artboard.
 *
 * Deliberately a list rather than the whole computed style: `getComputedStyle`
 * has some four hundred entries, and shipping those through the store on every
 * click would make selecting a button cost more than rendering the screen.
 */
export const MEASURED_PROPERTIES = [
  'display',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'color',
  'background-color',
  'opacity',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-radius',
  'box-shadow',
] as const;

/* ------------------------------------------------------------------ *
 * Colours
 * ------------------------------------------------------------------ */

/**
 * A colour as `input[type=color]` demands it: six hex digits, nothing else.
 *
 * What arrives is whatever the browser resolved — `rgb(37, 99, 235)` for a
 * token, a hex for something typed by hand — and the swatch has to show it
 * either way, because the swatch is how most people pick a colour.
 */
export function toHex(value: string): string {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return '#000000';

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;

  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(trimmed);
  if (long) return `#${long[1]}`;

  const rgb = /^rgba?\(([^)]+)\)$/.exec(trimmed);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return `#${[r!, g!, b!].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#000000';
}

/** True for a colour the browser resolved to "no colour at all". */
export function isTransparent(value: string): boolean {
  const trimmed = (value ?? '').trim().toLowerCase();
  return trimmed === 'transparent' || trimmed === 'rgba(0, 0, 0, 0)';
}

/** Every colour token as the CSS a screen should be written with. */
export function colorSuggestions(system: DesignSystem): { label: string; value: string }[] {
  return system.colors.map((token) => ({
    label: token.name,
    value: `var(--color-${tokenSlug(token.name)})`,
  }));
}

export function shadowSuggestions(system: DesignSystem): { label: string; value: string }[] {
  return system.shadows.map((token) => ({
    label: token.name,
    value: `var(--shadow-${tokenSlug(token.name)})`,
  }));
}

export function radiusSuggestions(system: DesignSystem): { label: string; value: string }[] {
  return system.radii.map((token) => ({
    label: token.name,
    value: `var(--radius-${tokenSlug(token.name)})`,
  }));
}

/** The type token classes a screen can wear, as the panel offers them. */
export function typeClasses(system: DesignSystem): { label: string; className: string }[] {
  return system.typography.map((token) => ({
    label: token.name,
    className: `text-${tokenSlug(token.name)}`,
  }));
}

/**
 * Font stacks offered by name.
 *
 * A design that names a font nobody has renders as Times in front of the
 * client, so these are all stacks that end somewhere safe.
 */
export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'System sans', value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'System serif', value: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { label: 'Monospace', value: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", ui-sans-serif, system-ui, sans-serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
];

/** Shorten a resolved font stack to the one name worth showing in a box. */
export function fontLabel(value: string): string {
  const first = (value ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  return first;
}
