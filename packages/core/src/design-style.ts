/**
 * The look of one element.
 *
 * A screen is HTML and CSS, and the stylesheet is still where a look belongs:
 * a button styled once is styled everywhere, and that is what keeps twenty
 * screens looking like one product. But a design is also a thing people push
 * around with a pointer — "that heading is too small", "make this card grey" —
 * and answering that by writing a CSS rule for one element is worse than
 * saying it on the element itself.
 *
 * So an element carries overrides in its own `style` attribute, and this is
 * the module that reads and writes them. Declarations keep the order they were
 * written in, so a shorthand somebody wrote first still loses to the longhand
 * the panel set afterwards, exactly as it would in a stylesheet.
 *
 * Values are written against the tokens wherever the editor can manage it —
 * `var(--color-accent)` rather than `#2563eb` — so an element nudged by hand
 * still follows the design system when the system changes.
 */

/** One element's inline declarations, in the order they appear. */
export type StyleDeclarations = Record<string, string>;

/**
 * Properties that never reach a document.
 *
 * `behavior` and `-moz-binding` load code in browsers old enough to matter to
 * nobody, and cost nothing to refuse. Everything else is presentation, and a
 * design is allowed to look like anything.
 */
const FORBIDDEN_PROPERTIES = new Set(['behavior', '-moz-binding', '-ms-behavior']);

const PROPERTY_PATTERN = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * Split a declaration list on the semicolons that actually separate it.
 *
 * `background: url(data:image/svg+xml;base64,…)` has a semicolon inside the
 * parentheses, and a naive split cuts the value in half. So depth and quoting
 * are tracked, which is the whole of the difference between this and `.split`.
 */
function splitDeclarations(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ';' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter(Boolean);
}

/** Read a `style` attribute into declarations, last one of a name winning. */
export function parseInlineStyle(value: string): StyleDeclarations {
  const out: StyleDeclarations = {};
  for (const declaration of splitDeclarations(value ?? '')) {
    const at = declaration.indexOf(':');
    if (at <= 0) continue;
    const name = declaration.slice(0, at).trim().toLowerCase();
    const body = declaration.slice(at + 1).trim();
    if (!name || !body) continue;
    out[name] = body;
  }
  return out;
}

/** Write declarations back out as a `style` attribute. */
export function formatInlineStyle(declarations: StyleDeclarations): string {
  return Object.entries(declarations)
    .filter(([name, value]) => name && value)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

export function isSafeStyleProperty(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return Boolean(lower) && PROPERTY_PATTERN.test(lower) && !FORBIDDEN_PROPERTIES.has(lower);
}

/**
 * A declaration value with anything that does something taken out.
 *
 * The same three refusals the stylesheet makes — `expression()`, a
 * `javascript:` url, a `url()` that reaches the network — for the same
 * reasons. A design that fetches from the internet stops being self-contained,
 * and the point of these is that they render the same in front of a client
 * whether or not there is wifi in the room.
 */
export function safeStyleValue(value: string): string | null {
  const trimmed = (value ?? '').trim().replace(/[;{}]+$/g, '').trim();
  if (!trimmed) return null;
  if (/expression\s*\(/i.test(trimmed)) return null;
  if (/javascript\s*:/i.test(trimmed)) return null;
  if (/@import/i.test(trimmed)) return null;
  if (/url\(\s*['"]?\s*(?:https?:)?\/\//i.test(trimmed)) return null;
  if (/[{}]/.test(trimmed)) return null;
  return trimmed;
}

export interface SanitizeStyleResult {
  style: string;
  /** Declarations that were dropped, named so the writer can be told. */
  removed: string[];
}

/** Everything in a `style` attribute that is allowed to stay, and what went. */
export function sanitizeInlineStyle(value: string): SanitizeStyleResult {
  const kept: StyleDeclarations = {};
  const removed: string[] = [];

  for (const [name, body] of Object.entries(parseInlineStyle(value))) {
    if (!isSafeStyleProperty(name)) {
      removed.push(`style ${name}`);
      continue;
    }
    const safe = safeStyleValue(body);
    if (safe === null) {
      removed.push(`style ${name}: ${body.slice(0, 32)}`);
      continue;
    }
    kept[name] = safe;
  }

  return { style: formatInlineStyle(kept), removed };
}

/**
 * Merge a patch of declarations over what an element already carries.
 *
 * A null or empty value removes the property rather than writing `x: ;` —
 * which is what the panel's "clear this" button means, and what returning a
 * field to blank has to mean if an override is ever to be taken back off.
 */
export function mergeInlineStyle(
  existing: string,
  patch: Record<string, string | null | undefined>,
  options: { replace?: boolean } = {},
): string {
  const declarations: StyleDeclarations = options.replace ? {} : parseInlineStyle(existing);

  for (const [rawName, rawValue] of Object.entries(patch)) {
    const name = rawName.trim().toLowerCase();
    if (!isSafeStyleProperty(name)) continue;
    if (rawValue === null || rawValue === undefined || !String(rawValue).trim()) {
      delete declarations[name];
      continue;
    }
    const safe = safeStyleValue(String(rawValue));
    if (safe === null) continue;
    declarations[name] = safe;
  }

  return formatInlineStyle(declarations);
}

/* ------------------------------------------------------------------ *
 * Writing values a person typed
 * ------------------------------------------------------------------ */

/** Values that are never a length, however much they look like a number. */
const UNITLESS = new Set([
  'opacity',
  'z-index',
  'font-weight',
  'line-height',
  'flex',
  'flex-grow',
  'flex-shrink',
  'order',
  'aspect-ratio',
  'grid-column',
  'grid-row',
]);

/**
 * What somebody meant by typing `240` into a width box.
 *
 * Pixels, is what — every design tool in the world reads a bare number that
 * way, and making the user type the unit is the kind of pedantry that gets a
 * tool put down. Anything with a unit, a keyword, a calc or a var is already
 * CSS and is left exactly as written.
 */
export function cssLength(property: string, value: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  if (UNITLESS.has(property)) return trimmed;
  return /^-?\d*\.?\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

/** The number out of a CSS length, for a slider or a stepper. `16px` → 16. */
export function lengthNumber(value: string): number | null {
  const match = /^(-?\d*\.?\d+)/.exec((value ?? '').trim());
  return match ? Number(match[1]) : null;
}
