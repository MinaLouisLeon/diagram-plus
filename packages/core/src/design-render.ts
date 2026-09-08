import { ELEMENT_CATALOG } from './design-catalog.js';
import { walkElements } from './design-ops.js';
import {
  DEVICE_FRAMES,
  type DesignDocument,
  type DesignElement,
  type DesignSystem,
  type ScreenDesign,
  type Sizing,
} from './design.js';

/**
 * Reading a design back as text.
 *
 * This is how a design reaches whoever builds it. The tree is written out as
 * an indented outline that says, for every box, what it is, what it says,
 * where its value comes from and what using it does — because that last pair
 * is the difference between a picture of a screen and an instruction to build
 * one.
 *
 * No markup is generated. The implementer writes the component in the
 * project's own stack; what they need from here is the contract, not somebody
 * else's div soup.
 */

const INDENT = '  ';

function quote(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim()}"`;
}

function sizing(value: Sizing): string {
  return typeof value === 'number' ? `${value}px` : value;
}

/** The layout of a container, in the shortest form that is still complete. */
function layoutNote(element: DesignElement): string {
  const info = ELEMENT_CATALOG[element.type];
  if (!info.container && element.type !== 'grid') return '';
  const { layout } = element;
  const parts: string[] = [];
  if (element.type === 'grid' && layout.columns) parts.push(`${layout.columns} columns`);
  else parts.push(layout.direction);
  if (layout.gap) parts.push(`gap ${layout.gap}`);
  const pad = layout.padding;
  if (pad.top || pad.right || pad.bottom || pad.left) {
    const even = pad.top === pad.right && pad.right === pad.bottom && pad.bottom === pad.left;
    parts.push(even ? `pad ${pad.top}` : `pad ${pad.top}/${pad.right}/${pad.bottom}/${pad.left}`);
  }
  if (layout.justify !== 'start') parts.push(layout.justify);
  if (layout.align !== 'stretch') parts.push(`align ${layout.align}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** The style tokens worth naming. Raw values are passed through as written. */
function styleNote(element: DesignElement): string {
  const { style } = element;
  const parts: string[] = [];
  if (style.text) parts.push(style.text);
  if (style.color) parts.push(style.color);
  if (style.background) parts.push(`on ${style.background}`);
  if (style.radius) parts.push(`radius ${style.radius}`);
  return parts.length ? ` [${parts.join(' · ')}]` : '';
}

/** The size, only when it is not the default "as wide as it can, as tall as it needs". */
function sizeNote(element: DesignElement): string {
  const { width, height } = element.layout;
  const parts: string[] = [];
  if (width !== 'fill') parts.push(`w ${sizing(width)}`);
  if (height !== 'hug') parts.push(`h ${sizing(height)}`);
  if (element.layout.grow) parts.push('grows');
  if (element.layout.absolute) parts.push(`at ${element.layout.x},${element.layout.y}`);
  return parts.length ? ` {${parts.join(', ')}}` : '';
}

/** One element as its headline: what it is and what it says. */
function headline(element: DesignElement): string {
  const info = ELEMENT_CATALOG[element.type];
  const words = element.text || element.label || element.placeholder;
  const name =
    element.name && element.name.toLowerCase() !== info.label.toLowerCase()
      ? ` ${element.name}`
      : '';

  let line = element.type + name;
  if (words) line += ` ${quote(words)}`;
  if (element.variant) line += ` [${element.variant}]`;
  if (element.icon && element.type !== 'icon') line += ` (icon ${element.icon})`;
  if (element.type === 'icon' && element.icon) line += ` ${element.icon}`;
  if (element.required) line += ' *required';
  if (element.disabled) line += ' *disabled';
  return line;
}

/** The lines under an element that say what it means rather than how it looks. */
function meaning(element: DesignElement): string[] {
  const out: string[] = [];
  if (element.binding) out.push(`value ← ${element.binding}`);
  if (element.action) out.push(`does → ${element.action}`);
  if (element.navigatesTo) out.push(`goes → ${element.navigatesTo}`);
  if (element.componentId) out.push(`component → ${element.componentId}`);
  if (element.visibleWhen) out.push(`only when ${element.visibleWhen}`);
  if (element.repeat?.over) {
    out.push(`repeats over ${element.repeat.over} (${element.repeat.count} shown)`);
  }
  if (element.columns.length) out.push(`columns: ${element.columns.join(', ')}`);
  if (element.options.length) {
    out.push(
      'options: ' +
        element.options
          .map((o) => `${o.label || o.value}${o.navigatesTo ? ` → ${o.navigatesTo}` : ''}`)
          .join(', '),
    );
  }
  if (element.helper) out.push(`helper: ${element.helper}`);
  if (element.src) out.push(`shows: ${element.src}`);
  if (element.notes) out.push(`note: ${element.notes}`);
  return out;
}

export interface OutlineOptions {
  /** Include layout, size and style notes. On by default. */
  showStyle?: boolean;
  /** Skip elements marked hidden. Off by default — hidden is still designed. */
  skipHidden?: boolean;
}

/** The element tree as an indented outline. */
export function renderElementOutline(
  root: DesignElement,
  options: OutlineOptions = {},
): string {
  const { showStyle = true, skipHidden = false } = options;
  const lines: string[] = [];

  const visit = (element: DesignElement, depth: number): void => {
    if (skipHidden && element.hidden) return;
    const pad = INDENT.repeat(depth);
    let line = `${pad}- ${headline(element)}`;
    if (showStyle) line += layoutNote(element) + sizeNote(element) + styleNote(element);
    if (element.hidden) line += ' *hidden';
    lines.push(line);

    for (const note of meaning(element)) lines.push(`${pad}${INDENT}${note}`);
    for (const child of element.children) visit(child, depth + 1);
  };

  visit(root, 0);
  return lines.join('\n');
}

/**
 * How far along a screen is, said plainly.
 *
 * This is the line that decides whether the tree below it is an instruction or
 * a placeholder, and it has to be in the spec: an untouched wireframe seeded
 * from a block and a design the user sat with their client and approved read
 * exactly the same as an outline, and building the first as though it were the
 * second is how a project ends up not looking like what was signed off.
 */
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
  lines.push(renderElementOutline(screen.root, options));

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
  const elements = document.screens.reduce((sum, s) => sum + walkElements(s.root).length, 0);
  const approved = document.screens.filter((s) => s.status === 'approved').length;
  return (
    `${document.screens.length} screen${document.screens.length === 1 ? '' : 's'}, ` +
    `${elements} elements, ${approved} approved (revision ${document.revision}).`
  );
}
