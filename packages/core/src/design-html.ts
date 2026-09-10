import { DefaultTreeAdapterTypes, parseFragment, serialize, serializeOuter } from 'parse5';
import { newId } from './ids.js';
import { sanitizeInlineStyle } from './design-style.js';

/**
 * The screen designs, as markup.
 *
 * A screen used to be a typed tree of `DesignElement`, and the editor drew it
 * with chrome of its own invention: a table was five grey dashes, an input was
 * an empty grey box. That is a wireframe, and the person using this tool shows
 * these to a client to win the work. So a screen is HTML and CSS now — the
 * browser lays it out, and what the client sees is what gets built.
 *
 * What the tree gave for free and this has to earn back is *meaning*. A
 * `button` was provably a button with an action on it because the schema said
 * so. Here the tag carries the kind and `data-*` carries the rest — where a
 * value comes from, what pressing something does, where it goes — so the
 * implementation spec can still be read out of a screen rather than guessed at.
 *
 * Everything here is deliberately isomorphic: parse5 is pure JavaScript with no
 * `node:` imports, so the same code runs in the MCP server, in the editor's
 * bundle and in the tests. That matters more than it sounds — it means the
 * outline the spec generates and the document the canvas edits can never
 * disagree about what a screen says.
 */

export type HtmlElement = DefaultTreeAdapterTypes.Element;
export type HtmlNode = DefaultTreeAdapterTypes.Node;
export type HtmlFragment = DefaultTreeAdapterTypes.DocumentFragment;
export type HtmlParent = DefaultTreeAdapterTypes.ParentNode;
export type HtmlChild = DefaultTreeAdapterTypes.ChildNode;

/** The attribute every element is addressed by, once normalised. */
export const EL_ID = 'data-el';

/* ------------------------------------------------------------------ *
 * Parsing and writing back
 * ------------------------------------------------------------------ */

export function parseHtml(html: string): HtmlFragment {
  return parseFragment(html ?? '');
}

export function serializeHtml(node: HtmlParent): string {
  return serialize(node);
}

/** One element and its own tag, rather than just what is inside it. */
export function serializeOuterHtml(node: HtmlNode): string {
  return serializeOuter(node as never);
}

/** Narrow a node to an element. Text and comments answer false. */
export function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node;
}

function children(node: HtmlNode): HtmlNode[] {
  return 'childNodes' in node ? (node.childNodes as HtmlNode[]) : [];
}

/** Every element under a node, in document order. */
export function walkHtml(node: HtmlNode): HtmlElement[] {
  const out: HtmlElement[] = [];
  const visit = (current: HtmlNode): void => {
    for (const child of children(current)) {
      if (isElement(child)) out.push(child);
      visit(child);
    }
  };
  visit(node);
  return out;
}

/** The element holding this one, or null at the top of the fragment. */
export function parentOf(element: HtmlElement): HtmlElement | null {
  const parent = element.parentNode;
  return parent && isElement(parent as HtmlNode) ? (parent as HtmlElement) : null;
}

/* ------------------------------------------------------------------ *
 * Attributes and words
 * ------------------------------------------------------------------ */

export function getAttr(element: HtmlElement, name: string): string {
  return element.attrs.find((a) => a.name === name)?.value ?? '';
}

export function hasAttr(element: HtmlElement, name: string): boolean {
  return element.attrs.some((a) => a.name === name);
}

export function setAttr(element: HtmlElement, name: string, value: string): void {
  const existing = element.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else element.attrs.push({ name, value });
}

export function removeAttr(element: HtmlElement, name: string): void {
  const at = element.attrs.findIndex((a) => a.name === name);
  if (at >= 0) element.attrs.splice(at, 1);
}

/** The words an element shows, with whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  let out = '';
  const visit = (current: HtmlNode): void => {
    for (const child of children(current)) {
      if ('value' in child && child.nodeName === '#text') out += child.value;
      else visit(child);
    }
  };
  visit(node);
  return out.replace(/\s+/g, ' ').trim();
}

/** The words directly on an element, ignoring anything its children say. */
export function ownTextOf(element: HtmlElement): string {
  return children(element)
    .filter((child) => child.nodeName === '#text' && 'value' in child)
    .map((child) => (child as DefaultTreeAdapterTypes.TextNode).value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Finding things
 * ------------------------------------------------------------------ */

/**
 * Resolve a reference to one element.
 *
 * By `data-el` first, because that is the identity the editor and the
 * operations use. Falling back to a tag name, or to the words on it, is what
 * makes a reference written by hand — "the Sign in button" — resolvable
 * without the caller having to read the markup first.
 */
export function findHtml(fragment: HtmlFragment, ref: string): HtmlElement | null {
  const needle = ref.trim();
  if (!needle) return null;
  const all = walkHtml(fragment);

  const byId = all.find((el) => getAttr(el, EL_ID) === needle);
  if (byId) return byId;

  const lower = needle.toLowerCase();
  const named = all.filter((el) => textOf(el).toLowerCase() === lower);
  if (named.length === 1) return named[0]!;

  return all.find((el) => el.tagName.toLowerCase() === lower) ?? null;
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

/**
 * Give every element a `data-el`, so it can be selected, dragged and edited.
 *
 * This is the whole trick that lets a text format keep what a typed tree gave
 * away for nothing. A click in the canvas reads the id off the element under
 * the pointer, the edit is applied to the parsed document here, and the result
 * is written back out — so selection, undo and the layers panel go on working
 * across a format where the document is a string.
 */
export function identifyHtml(fragment: HtmlFragment): number {
  let minted = 0;
  for (const element of walkHtml(fragment)) {
    if (getAttr(element, EL_ID)) continue;
    setAttr(element, EL_ID, newId('els'));
    minted += 1;
  }
  return minted;
}

/** Fresh ids throughout — for duplicating a screen or a subtree. */
export function reidentifyHtml(html: string): string {
  const fragment = parseHtml(html);
  for (const element of walkHtml(fragment)) setAttr(element, EL_ID, newId('els'));
  return serializeHtml(fragment);
}

/* ------------------------------------------------------------------ *
 * Safety
 * ------------------------------------------------------------------ */

/**
 * Tags that never survive a write.
 *
 * The canvas renders this markup in an iframe with no `allow-scripts`, so the
 * sandbox is the real boundary and nothing here can execute either way. This
 * is the second lock: a design is a picture of a screen, and none of these
 * belong in one.
 */
const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'link',
  'base',
  'meta',
  'noscript',
  'style',
]);

/** URL-bearing attributes, checked for schemes that do something. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'srcset', 'data']);

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return true;
  // Anything that resolves relatively is fine; a scheme has to be one we allow.
  if (/^[a-z][a-z0-9+.-]*:/.test(trimmed)) {
    return trimmed.startsWith('data:image/') || trimmed.startsWith('mailto:');
  }
  return !trimmed.startsWith('//');
}

export interface SanitizeResult {
  html: string;
  /** What was taken out, for reporting back to whoever wrote it. */
  removed: string[];
}

/**
 * Strip anything from a screen that could do something rather than show
 * something, and report what went.
 *
 * External image URLs are a judgement rather than a danger: a design that
 * fetches from the internet stops being self-contained, leaks whoever is
 * reviewing it to a third party, and renders differently offline in front of a
 * client. So the URL is kept on `data-src` — the implementer can still see what
 * was intended — and the `src` is dropped. Inline SVG and `data:image/` URIs
 * are left alone, which is what a design should be using anyway.
 */
export function sanitizeHtml(html: string): SanitizeResult {
  const fragment = parseHtml(html);
  const removed: string[] = [];

  const prune = (node: HtmlParent): void => {
    const kept: HtmlChild[] = [];
    for (const child of node.childNodes) {
      if (isElement(child as HtmlNode)) {
        const element = child as HtmlElement;
        const tag = element.tagName.toLowerCase();
        if (FORBIDDEN_TAGS.has(tag)) {
          removed.push(tag === 'style' ? '<style> (put CSS in the screen\'s css instead)' : `<${tag}>`);
          continue;
        }
        for (const attr of [...element.attrs]) {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on')) {
            removed.push(`${name} on <${tag}>`);
            removeAttr(element, attr.name);
            continue;
          }
          // An element's own look, which the properties panel writes and a
          // model may write by hand. It goes through the same gate the
          // stylesheet does — a `url()` reaching the network is no more
          // welcome for being on one element than in a rule.
          if (name === 'style') {
            const cleaned = sanitizeInlineStyle(attr.value);
            if (cleaned.removed.length) {
              removed.push(...cleaned.removed.map((what) => `${what} on <${tag}>`));
            }
            if (cleaned.style) setAttr(element, attr.name, cleaned.style);
            else removeAttr(element, attr.name);
            continue;
          }
          if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
            const external = /^https?:/i.test(attr.value.trim());
            if (external && (name === 'src' || name === 'srcset' || name === 'poster')) {
              setAttr(element, 'data-src', attr.value);
              removed.push(`external ${name} on <${tag}> (kept as data-src)`);
            } else {
              removed.push(`${name}="${attr.value.slice(0, 32)}" on <${tag}>`);
            }
            removeAttr(element, attr.name);
          }
        }
        prune(element);
      }
      kept.push(child);
    }
    node.childNodes = kept;
  };

  prune(fragment);
  return { html: serializeHtml(fragment), removed: [...new Set(removed)] };
}

/**
 * The same treatment for a stylesheet.
 *
 * `@import` and remote `url()` reach the network; `expression()` and
 * `javascript:` execute in browsers old enough to matter to nobody, and cost
 * nothing to refuse.
 */
export function sanitizeCss(css: string): { css: string; removed: string[] } {
  const removed: string[] = [];
  let out = css ?? '';

  const drop = (pattern: RegExp, label: string, replacement = ''): void => {
    if (pattern.test(out)) {
      removed.push(label);
      out = out.replace(pattern, replacement);
    }
  };

  drop(/@import\b[^;]*;?/gi, '@import');
  drop(/expression\s*\(/gi, 'expression()');
  drop(/javascript\s*:/gi, 'javascript: url');
  drop(/url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi, 'remote url()', 'none');

  return { css: out, removed: [...new Set(removed)] };
}

/* ------------------------------------------------------------------ *
 * The one way markup enters the document
 * ------------------------------------------------------------------ */

export interface NormalizeResult {
  html: string;
  removed: string[];
  minted: number;
}

/**
 * Sanitise, then give everything an id.
 *
 * Every write goes through here — the MCP tools, the REST API and the editor
 * alike — for the same reason `hydrateElement` was the only door into the typed
 * tree: one gate is the only kind that holds.
 */
export function normalizeHtml(html: string): NormalizeResult {
  const { html: safe, removed } = sanitizeHtml(html);
  const fragment = parseHtml(safe);
  const minted = identifyHtml(fragment);
  return { html: serializeHtml(fragment), removed, minted };
}
