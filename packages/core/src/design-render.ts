import {
  getAttr,
  hasAttr,
  isElement,
  parseHtml,
  textOf,
  walkHtml,
  type HtmlElement,
  type HtmlNode,
} from './design-html.js';
import { countElements, factsOf } from './design-ops.js';
import {
  DEVICE_FRAMES,
  type DesignDocument,
  type DesignSystem,
  type ScreenDesign,
} from './design.js';

/**
 * Reading a design back as text.
 *
 * This is how a design reaches whoever builds it: an indented outline saying,
 * for every element, what it is, what it says, where its value comes from and
 * what using it does — because that last pair is the difference between a
 * picture of a screen and an instruction to build one.
 *
 * The markup goes to the implementer as well, and is the thing to build from.
 * The outline sits above it as the contract at a glance, because a person
 * about to build a screen wants to know what it is bound to before they read a
 * single tag.
 */

const INDENT = '  ';

function quote(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim()}"`;
}

/** What an element is, in the shortest form that is still unambiguous. */
function headline(element: HtmlElement): string {
  const facts = factsOf(element);
  const tag = facts.tag;
  const kind = tag === 'input' ? `input[${getAttr(element, 'type') || 'text'}]` : tag;

  let line = kind;
  const classes = facts.classes.filter((c) => !c.startsWith('text-'));
  if (classes.length) line += `.${classes.join('.')}`;
  if (facts.text) line += ` ${quote(facts.text)}`;

  const placeholder = getAttr(element, 'placeholder');
  if (!facts.text && placeholder) line += ` ${quote(placeholder)}`;
  if (facts.required) line += ' *required';
  if (facts.disabled) line += ' *disabled';
  if (facts.hidden) line += ' *hidden';
  return line;
}

/**
 * The lines under an element that say what it means rather than how it looks.
 *
 * This is the part that has to survive the move from a typed tree to markup
 * intact — it is the difference between a picture of a screen and something
 * somebody can build. Every one of these reads an attribute the format
 * promises will be there.
 */
function meaning(element: HtmlElement, showStyle = true): string[] {
  const facts = factsOf(element);
  const out: string[] = [];

  if (facts.binding) out.push(`value \u2190 ${facts.binding}`);
  if (facts.action) out.push(`does \u2192 ${facts.action}`);
  if (facts.navigatesTo) out.push(`goes \u2192 ${facts.navigatesTo}`);
  if (facts.component) out.push(`component \u2192 ${facts.component}`);
  if (facts.visibleWhen) out.push(`only when ${facts.visibleWhen}`);
  if (facts.repeat) {
    out.push(`repeats over ${facts.repeat.over} (${facts.repeat.count} shown)`);
  }

  // A table's columns and a dropdown's choices are said once, here, rather
  // than by walking into a dozen `th`s and `option`s that say nothing else.
  if (facts.tag === 'table') {
    const columns = walkHtml(element)
      .filter((el) => el.tagName === 'th')
      .map((el) => textOf(el))
      .filter(Boolean);
    if (columns.length) out.push(`columns: ${columns.join(', ')}`);
  }
  if (facts.tag === 'select' || facts.tag === 'datalist') {
    const options = walkHtml(element)
      .filter((el) => el.tagName === 'option')
      .map((el) => textOf(el) || getAttr(el, 'value'))
      .filter(Boolean);
    if (options.length) out.push(`options: ${options.join(', ')}`);
  }

  const src = getAttr(element, 'data-src');
  if (src) out.push(`shows: ${src}`);
  const note = getAttr(element, 'data-note');
  if (note) out.push(`note: ${note}`);

  // Last, and only if it is there: what this element was styled to on its own,
  // apart from the stylesheet. An implementer has to be told, because it is
  // precisely where the screen departs from what every other button does — but
  // it goes under the contract rather than over it, since what a thing is
  // bound to is read before what colour it was made.
  const overrides = Object.entries(facts.style);
  if (showStyle && overrides.length) {
    out.push(`styled: ${overrides.map(([name, value]) => `${name}: ${value}`).join('; ')}`);
  }
  return out;
}

/** Elements whose insides the outline states in a line rather than walking. */
const SUMMARISED = new Set(['table', 'select', 'datalist']);

export interface OutlineOptions {
  /** Include the class names each element carries. On by default. */
  showStyle?: boolean;
  /** Skip elements marked hidden. Off by default — hidden is still designed. */
  skipHidden?: boolean;
}

/**
 * A screen's markup as an indented outline.
 *
 * The markup itself goes into the spec too, and is the thing to build from.
 * This sits above it as the contract at a glance: what is on the screen, what
 * each part is bound to, and what using it does — the questions an implementer
 * asks before reading a single tag.
 */
export function renderElementOutline(html: string, options: OutlineOptions = {}): string {
  const { showStyle = true, skipHidden = false } = options;
  const lines: string[] = [];

  const visit = (node: HtmlNode, depth: number): void => {
    if (!('childNodes' in node)) return;
    for (const child of node.childNodes) {
      if (!isElement(child as HtmlNode)) continue;
      const element = child as HtmlElement;
      if (skipHidden && hasAttr(element, 'hidden')) continue;

      const pad = INDENT.repeat(depth);
      let line = `${pad}- ${headline(element)}`;
      if (!showStyle) line = line.replace(/^(\s*- [a-z0-9[\]]+)\.[^ "]*/i, '$1');
      lines.push(line);
      for (const note of meaning(element, showStyle)) lines.push(`${pad}${INDENT}${note}`);
      // Whatever is inside these has already been said, once, above.
      if (SUMMARISED.has(element.tagName.toLowerCase())) continue;
      visit(element, depth + 1);
    }
  };

  visit(parseHtml(html), 0);
  return lines.join('\n');
}


function statusNote(screen: ScreenDesign): string {
  switch (screen.status) {
    case 'approved':
      return '**Approved.** Build this exactly: these elements, this nesting, this wording. ' +
        'If something here cannot work, stop and say so rather than improvising a different screen.';
    case 'drafted':
      return '**Drafted, not yet approved.** Build it as drawn, and flag it for the user to ' +
        'confirm before it is shown to anybody.';
    default:
      return '**Not designed yet** — this is a wireframe seeded from the block, not a design. ' +
        'Ask before building it, or draw it first with design_screen.';
  }
}

/** One screen, as the section that goes into the implementation spec. */
export function renderScreenOutline(screen: ScreenDesign, options: OutlineOptions = {}): string {
  const preset = DEVICE_FRAMES[screen.device];
  const lines: string[] = [];
  const label = screen.variant ? `${screen.name} — ${screen.variant}` : screen.name;

  lines.push(
    `**Design — ${label}** · ${preset.label.toLowerCase()} ${screen.frame.width}×${screen.frame.height}` +
      (screen.route ? ` · \`${screen.route}\`` : ''),
  );
  lines.push('');
  lines.push(statusNote(screen));
  lines.push('');
  if (screen.purpose) {
    lines.push(screen.purpose);
    lines.push('');
  }
  lines.push(renderElementOutline(screen.html, options));

  if (screen.states.length) {
    lines.push('');
    lines.push('**Other states**');
    lines.push('');
    for (const state of screen.states) {
      const when = state.when ? ` (${state.when})` : '';
      lines.push(`- **${state.name || 'State'}**${when} — ${state.changes || 'unspecified'}`);
    }
  }

  if (screen.notes) {
    lines.push('');
    lines.push(`> ${screen.notes.replace(/\n/g, '\n> ')}`);
  }

  return lines.join('\n');
}

/** The tokens, as tables. Everything a screen refers to is defined here. */
export function renderDesignSystem(system: DesignSystem): string {
  const lines: string[] = [];
  if (system.name) lines.push(`**${system.name}**`, '');
  if (system.voice) lines.push(system.voice, '');

  if (system.colors.length) {
    lines.push('**Colours**', '');
    lines.push('| Token | Value | On | Use |');
    lines.push('| --- | --- | --- | --- |');
    for (const color of system.colors) {
      lines.push(
        `| \`${color.name}\` | \`${color.value}\` | ${color.on ? `\`${color.on}\`` : '—'} | ${color.description || '—'} |`,
      );
    }
    lines.push('');
  }

  if (system.typography.length) {
    lines.push('**Type scale**', '');
    lines.push('| Token | Size | Weight | Line height | Use |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const type of system.typography) {
      lines.push(
        `| \`${type.name}\` | ${type.size}px | ${type.weight} | ${type.lineHeight} | ${type.description || '—'} |`,
      );
    }
    lines.push('');
  }

  lines.push(`**Spacing** — multiples of ${system.spacingBase}px.`, '');

  if (system.radii.length) {
    lines.push(
      '**Radii** — ' + system.radii.map((r) => `\`${r.name}\` ${r.value}`).join(', '),
      '',
    );
  }
  if (system.shadows.length) {
    lines.push(
      '**Shadows** — ' + system.shadows.map((s) => `\`${s.name}\` \`${s.value}\``).join(', '),
      '',
    );
  }
  if (system.notes) lines.push(system.notes, '');

  return lines.join('\n').trim();
}

/** The whole design document, for `read_screen_design` with no screen named. */
export function renderDesign(document: DesignDocument, options: OutlineOptions = {}): string {
  const lines: string[] = [`# ${document.name || document.slug} — screen designs`, ''];
  lines.push(
    `${document.screens.length} screen${document.screens.length === 1 ? '' : 's'}, revision ${document.revision}.`,
    '',
  );

  lines.push('## Design system', '');
  lines.push(renderDesignSystem(document.system), '');

  const ordered = [...document.screens].sort((a, b) => a.order - b.order);
  for (const screen of ordered) {
    const label = screen.variant ? `${screen.name} — ${screen.variant}` : screen.name;
    lines.push(`## ${label}`, '');
    if (screen.orphaned) {
      lines.push('> The block this screen designed has been deleted from the diagram.', '');
    }
    lines.push(renderScreenOutline(screen, options), '');
  }

  if (document.notes) lines.push('## Notes', '', document.notes, '');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** A one-line count for tool responses and the editor's status strip. */
export function describeDesign(document: DesignDocument): string {
  const elements = document.screens.reduce((sum, s) => sum + countElements(s.html), 0);
  const approved = document.screens.filter((s) => s.status === 'approved').length;
  return (
    `${document.screens.length} screen${document.screens.length === 1 ? '' : 's'}, ` +
    `${elements} elements, ${approved} approved (revision ${document.revision}).`
  );
}
