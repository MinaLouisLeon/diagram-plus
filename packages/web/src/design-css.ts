import type { DesignDocument, DesignSystem, ScreenDesign } from '@diagram-plus/core/browser';
import { systemToCss } from '@diagram-plus/core/browser';

/**
 * Assembling the page an artboard shows.
 *
 * A screen is HTML and CSS, so the editor no longer decides what it looks
 * like — the browser does. What is left here is putting the pieces in the
 * right order: the tokens as custom properties, then the stylesheet every
 * screen shares, then the screen's own CSS, then its markup.
 *
 * It runs inside an iframe rather than in the page. That is not only for
 * safety, though it is that too: it is the only way a screen can be styled
 * without the editor's own CSS leaking into it, and the only way a design's
 * `button { … }` rule can mean what it says instead of restyling the toolbar.
 */

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

/**
 * Resolve a token name to its value, falling through to the raw string.
 *
 * Anything that is not a known token is passed along untouched, so `#ff0000`,
 * `12px` and `rgba(...)` all keep working. That matters because a design in
 * progress is usually half token and half something somebody typed.
 */
export function color(system: DesignSystem, value: string): string {
  if (!value) return '';
  return system.colors.find((token) => token.name === value)?.value ?? value;
}

/** The readable colour for text on top of a background token. */
export function colorOn(system: DesignSystem, value: string): string {
  const token = system.colors.find((c) => c.name === value);
  return token?.on ? color(system, token.on) : '';
}

export function radius(system: DesignSystem, value: string): string {
  if (!value) return '';
  const token = system.radii.find((r) => r.name === value);
  if (token) return token.value;
  return /^\d+$/.test(value) ? `${value}px` : value;
}

/** What a screen's background resolves to. */
export function screenBackground(system: DesignSystem, value: string): string {
  return color(system, value) || '#ffffff';
}

export function hairline(system: DesignSystem): string {
  return color(system, 'border') || '#cbd5e1';
}

export function mutedInk(system: DesignSystem): string {
  return color(system, 'subtle') || color(system, 'muted') || '#64748b';
}

/* ------------------------------------------------------------------ *
 * The page inside an artboard
 * ------------------------------------------------------------------ */

/**
 * The chrome the editor adds on top of a design, and nothing more.
 *
 * Selection has to be visible without being part of the design, so it is an
 * outline drawn outside the box rather than anything that affects layout — a
 * border would move every element by a pixel the moment you clicked it.
 */
const EDITOR_CHROME = `
html, body { height: 100%; }
body { cursor: default; }
[data-el] { outline: 1px solid transparent; outline-offset: -1px; transition: outline-color 80ms; }
body.picking [data-el]:hover { outline-color: rgba(37, 99, 235, 0.45); }
body.picking [data-el].dz-selected { outline: 2px solid #2563eb; outline-offset: -1px; }
/* A screen still being written should not be able to trap the pointer. */
[data-el] { pointer-events: auto; }
`;

/**
 * One screen as a whole HTML document, ready for an iframe's `srcdoc`.
 *
 * The order matters and is the whole contract: tokens first, because
 * everything after refers to them; the shared stylesheet next, so a screen
 * inherits the product's look; the screen's own CSS last, so it can override
 * without `!important`.
 */
export function screenDocument(
  design: DesignDocument,
  screen: ScreenDesign,
  options: { interactive?: boolean } = {},
): string {
  const background = screenBackground(design.system, screen.background);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${systemToCss(design.system)}</style>
<style>${design.css}</style>
<style>body { background: ${background}; }</style>
<style>${screen.css}</style>
<style>${EDITOR_CHROME}</style>
</head>
<body class="${options.interactive === false ? '' : 'picking'}">
${screen.html}
</body>
</html>`;
}
