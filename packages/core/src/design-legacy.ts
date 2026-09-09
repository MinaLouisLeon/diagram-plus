import { newId } from './ids.js';

/**
 * Reading designs written in the old format.
 *
 * Version 1 stored a screen as a typed tree of elements. Version 2 stores it as
 * HTML and CSS. This file is the bridge, and the only place the old shape still
 * exists — everything here is read-only, runs once per file on the way in, and
 * is expected to be deleted the year nobody has a version 1 document left.
 *
 * It is deliberately loose about what it accepts. A file on disk may have been
 * hand-edited, may predate a field, may have been written by a version of this
 * tool nobody remembers; the job is to get the user's design across, not to
 * adjudicate it. Anything unrecognised falls back to a `div` with its words
 * intact, which is worse than a perfect translation and far better than a
 * screen that will not open.
 */

interface LegacyLayout {
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  align?: string;
  justify?: string;
  wrap?: boolean;
  columns?: number;
  width?: number | string;
  height?: number | string;
  grow?: number;
}

interface LegacyElement {
  type?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  helper?: string;
  variant?: string;
  icon?: string;
  src?: string;
  alt?: string;
  options?: { label?: string; value?: string; navigatesTo?: string; selected?: boolean }[];
  columns?: string[];
  repeat?: { over?: string; count?: number } | null;
  layout?: LegacyLayout;
  style?: Record<string, unknown>;
  binding?: string;
  action?: string;
  navigatesTo?: string;
  visibleWhen?: string;
  componentId?: string;
  required?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  notes?: string;
  children?: LegacyElement[];
}

/** The tag that carries each old element type's meaning. */
const TAGS: Record<string, string> = {
  frame: 'div', stack: 'div', grid: 'div', card: 'div', form: 'form',
  nav: 'nav', header: 'header', footer: 'footer', sidebar: 'aside',
  modal: 'dialog', tabs: 'div', list: 'ul', table: 'table',
  text: 'p', heading: 'h2', image: 'img', icon: 'span', avatar: 'span',
  badge: 'span', divider: 'hr', spacer: 'div', chart: 'figure', map: 'figure',
  video: 'figure',
  button: 'button', link: 'a', input: 'input', textarea: 'textarea',
  select: 'select', checkbox: 'input', radio: 'input', toggle: 'input',
  slider: 'input', search: 'input', upload: 'input', component: 'div',
};

/** Controls that are an `<input>` of some particular kind. */
const INPUT_TYPES: Record<string, string> = {
  checkbox: 'checkbox', radio: 'radio', toggle: 'checkbox',
  slider: 'range', search: 'search', upload: 'file',
};

const VOID_TAGS = new Set(['img', 'hr', 'input', 'br']);
const LABELLED = new Set(['input', 'textarea', 'select', 'search', 'upload', 'slider', 'radio']);

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function size(value: number | string | undefined, axis: 'width' | 'height'): string {
  if (typeof value === 'number') return `${axis}:${value}px;`;
  if (value === 'fill') return axis === 'width' ? 'width:100%;' : 'flex:1 1 auto;';
  return '';
}

/** The old fill/hug layout intent, as the flexbox it always meant. */
function styleFor(element: LegacyElement): string {
  const layout = element.layout ?? {};
  const style = (element.style ?? {}) as Record<string, string | number>;
  const parts: string[] = [];

  const container = (element.children?.length ?? 0) > 0;
  if (element.type === 'grid' && (layout.columns ?? 0) > 0) {
    parts.push(`display:grid;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));`);
  } else if (container) {
    parts.push('display:flex;', `flex-direction:${layout.direction ?? 'column'};`);
    if (layout.wrap) parts.push('flex-wrap:wrap;');
    if (layout.align && layout.align !== 'stretch') parts.push(`align-items:${layout.align};`);
    if (layout.justify && layout.justify !== 'start') {
      const map: Record<string, string> = {
        between: 'space-between', around: 'space-around', evenly: 'space-evenly',
        start: 'flex-start', end: 'flex-end', center: 'center',
      };
      parts.push(`justify-content:${map[layout.justify] ?? layout.justify};`);
    }
  }
  if (layout.gap) parts.push(`gap:${layout.gap}px;`);

  const pad = layout.padding;
  if (pad && (pad.top || pad.right || pad.bottom || pad.left)) {
    parts.push(`padding:${pad.top ?? 0}px ${pad.right ?? 0}px ${pad.bottom ?? 0}px ${pad.left ?? 0}px;`);
  }
  parts.push(size(layout.width, 'width'), size(layout.height, 'height'));
  if (layout.grow) parts.push(`flex-grow:${layout.grow};`);

  // Tokens become the variables they now are, so a migrated screen restyles
  // with the panel exactly as it did before.
  if (style['background']) parts.push(`background:var(--color-${slug(String(style['background']))});`);
  if (style['color']) parts.push(`color:var(--color-${slug(String(style['color']))});`);
  if (style['radius']) parts.push(`border-radius:var(--radius-${slug(String(style['radius']))});`);
  if (style['shadow']) parts.push(`box-shadow:var(--shadow-${slug(String(style['shadow']))});`);
  if (style['border'] && style['borderWidth']) {
    parts.push(`border:${style['borderWidth']}px solid var(--color-${slug(String(style['border']))});`);
  }
  if (style['align'] && style['align'] !== 'left') parts.push(`text-align:${style['align']};`);
  if (style['opacity'] !== undefined && style['opacity'] !== 1) parts.push(`opacity:${style['opacity']};`);

  return parts.filter(Boolean).join('');
}

/** A token name as a CSS custom-property suffix: `heading.lg` cannot be one. */
export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function attrsFor(element: LegacyElement): string {
  const out: string[] = [`data-el="${newId('els')}"`];
  const type = element.type ?? 'frame';

  const cls: string[] = [];
  if (type !== 'div' && !TAGS[type]) cls.push(type);
  else if (['card', 'badge', 'avatar', 'icon', 'spacer', 'tabs', 'grid', 'stack'].includes(type)) {
    cls.push(type);
  }
  if (element.variant) cls.push(element.variant);
  const textToken = (element.style ?? {})['text'];
  if (textToken) cls.push(`text-${slug(String(textToken))}`);
  if (cls.length) out.push(`class="${escapeAttr(cls.join(' '))}"`);

  const style = styleFor(element);
  if (style) out.push(`style="${escapeAttr(style)}"`);

  if (INPUT_TYPES[type]) out.push(`type="${INPUT_TYPES[type]}"`);
  else if (type === 'input' && element.variant === 'password') out.push('type="password"');

  if (element.placeholder) out.push(`placeholder="${escapeAttr(element.placeholder)}"`);
  if (element.alt !== undefined && type === 'image') out.push(`alt="${escapeAttr(element.alt || element.src || '')}"`);
  if (element.required) out.push('required');
  if (element.disabled) out.push('disabled');
  if (element.hidden) out.push('hidden');

  // The contract. Every one of these has to survive the move, or the spec the
  // implementer builds from quietly loses its wiring.
  if (element.binding) out.push(`data-binding="${escapeAttr(element.binding)}"`);
  if (element.action) out.push(`data-action="${escapeAttr(element.action)}"`);
  if (element.navigatesTo) out.push(`data-navigates-to="${escapeAttr(element.navigatesTo)}"`);
  if (element.componentId) out.push(`data-component="${escapeAttr(element.componentId)}"`);
  if (element.visibleWhen) out.push(`data-visible-when="${escapeAttr(element.visibleWhen)}"`);
  if (element.repeat?.over) {
    out.push(`data-repeat="${escapeAttr(element.repeat.over)}"`);
    out.push(`data-repeat-count="${element.repeat.count ?? 3}"`);
  }
  if (element.icon) out.push(`data-icon="${escapeAttr(element.icon)}"`);
  if (element.src && type !== 'image') out.push(`data-src="${escapeAttr(element.src)}"`);
  if (element.notes) out.push(`data-note="${escapeAttr(element.notes)}"`);
  if (element.name) out.push(`data-name="${escapeAttr(element.name)}"`);

  return out.join(' ');
}

function bodyFor(element: LegacyElement, depth: number): string {
  const type = element.type ?? 'frame';
  const pad = '  '.repeat(depth + 1);

  if (type === 'table') {
    const columns = element.columns ?? [];
    const head = columns.length
      ? `\n${pad}  <thead><tr>${columns.map((c) => `<th>${escapeText(c)}</th>`).join('')}</tr></thead>`
      : '';
    const body = columns.length
      ? `\n${pad}  <tbody><tr>${columns.map(() => '<td></td>').join('')}</tr></tbody>`
      : '';
    return `${head}${body}\n${pad}`;
  }

  if (type === 'select' && element.options?.length) {
    const options = element.options
      .map((o) => `<option${o.selected ? ' selected' : ''}>${escapeText(o.label || o.value || '')}</option>`)
      .join('');
    return options;
  }

  if (type === 'nav' && element.options?.length) {
    const links = element.options
      .map((o) => {
        const to = o.navigatesTo ? ` data-navigates-to="${escapeAttr(o.navigatesTo)}"` : '';
        return `\n${pad}  <a href="#"${to}>${escapeText(o.label || o.value || 'Link')}</a>`;
      })
      .join('');
    return `${links}\n${pad}`;
  }

  const words = element.text ? escapeText(element.text) : '';
  const children = (element.children ?? []).map((child) => toHtml(child, depth + 1)).join('');
  if (!words && !children) return '';
  if (!children) return words;
  return `${words ? `\n${pad}${words}` : ''}${children}\n${'  '.repeat(depth)}`;
}

/** One old element, and everything under it, as markup. */
function toHtml(element: LegacyElement, depth = 0): string {
  const type = element.type ?? 'frame';
  const tag = TAGS[type] ?? 'div';
  const indent = '\n' + '  '.repeat(depth);
  const attrs = attrsFor(element);

  if (VOID_TAGS.has(tag)) {
    const control = `${indent}<${tag} ${attrs}>`;
    if (!LABELLED.has(type) || !element.label) return control;
    return `${indent}<label>${escapeText(element.label)}${control}${
      element.helper ? `\n${'  '.repeat(depth)}  <small>${escapeText(element.helper)}</small>` : ''
    }\n${'  '.repeat(depth)}</label>`;
  }

  const open = `${indent}<${tag}${type === 'modal' ? ' open' : ''} ${attrs}>`;
  const body = bodyFor(element, depth);
  const close = `</${tag}>`;

  if (LABELLED.has(type) && element.label) {
    return `${indent}<label>${escapeText(element.label)}${indent}  <${tag} ${attrs}>${body}${close}${
      element.helper ? `${indent}  <small>${escapeText(element.helper)}</small>` : ''
    }${indent}</label>`;
  }
  return `${open}${body}${close}`;
}

/**
 * A version 1 screen tree, as the HTML that replaces it.
 *
 * Every binding, action, destination and repeat comes across — those are the
 * whole point. The layout comes across as inline styles rather than as classes
 * on purpose: it is a faithful translation of what the old document literally
 * said, not an attempt to write the stylesheet somebody would have written by
 * hand. The user can tidy it, or ask Claude to.
 */
export function legacyTreeToHtml(root: unknown): string {
  if (!root || typeof root !== 'object') return '';
  return toHtml(root as LegacyElement).trimStart();
}
