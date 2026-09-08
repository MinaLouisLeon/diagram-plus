import type { Block, BlockOf, BlockType } from './blocks.js';
import type { Field } from './common.js';
import type { Diagram } from './diagram.js';
import { getAttr } from './design-html.js';
import {
  createDesignDocument,
  createScreen,
  emptyScreenHtml,
} from './design-factory.js';
import { factsOf } from './design-ops.js';
import { layoutDesign, walkScreen } from './design-ops.js';
import {
  DEVICE_FRAMES,
  type DesignDocument,
  type Device,
  type ScreenDesign,
} from './design.js';
import { nowIso } from './ids.js';

/**
 * Keeping the designs and the diagram in step.
 *
 * The diagram already says which screens exist, what each is for, what it
 * holds and what its buttons reach. Making somebody re-type that into a design
 * tool is how design and specification drift apart, so a screen's design
 * *starts* as a reading of its block: a header with the screen's name, its
 * purpose, a field per piece of state, a button per action, each already
 * pointing at the endpoint the diagram says it calls.
 *
 * What comes out is a wireframe, not a finished screen — the point is that it
 * is a wireframe of the right thing, with every hook already wired, so the
 * first real design decision is the first thing anyone has to make.
 *
 * After that the two documents are kept in touch rather than in lockstep:
 * `reconcileDesign` brings in new screens and flags ones whose block has gone,
 * but never overwrites a screen somebody has worked on. Same bargain as the
 * client view, and for the same reason — the work put in here is worth more
 * than the convenience of a clean re-derive.
 */

/** Block types that get a design of their own. */
export const DESIGNABLE_TYPES: BlockType[] = ['ui_screen', 'ui_component'];

export function isDesignable(block: Block): boolean {
  return DESIGNABLE_TYPES.includes(block.type);
}

/** The blocks a design document is expected to cover, in diagram order. */
export function designableBlocks(diagram: Diagram): Block[] {
  return diagram.blocks.filter(isDesignable);
}

/* ------------------------------------------------------------------ *
 * Reading a block as a wireframe
 * ------------------------------------------------------------------ */

const LONG_TEXT = /(description|notes?|message|body|comment|bio|summary|content|address)/i;
const SECRET = /(password|secret|token|pin)/i;
const CHOICE = /(status|type|kind|category|role|state|country|currency|method)/i;

/** Escape text going into markup. Everything seeded here is somebody's words. */
function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `firstName` / `first_name` becomes `First name`. */
function humanize(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The control a piece of screen state should be captured with.
 *
 * The guesswork is the same guesswork it always was — a field called
 * `password` is a password box, one called `status` is a dropdown, one called
 * `description` is a textarea. Only what it emits has changed.
 */
function controlFor(field: Field): string {
  const type = field.type.toLowerCase();
  const name = field.name;
  const label = esc(humanize(name));
  const bind = `data-binding="state.${esc(name)}"`;
  const req = field.required ? ' required' : '';
  const help = field.description ? `\n      <small>${esc(field.description)}</small>` : '';
  const wrap = (control: string): string =>
    `    <label>${label}\n      ${control}${help}\n    </label>`;

  if (type.includes('bool')) return wrap(`<input type="checkbox" ${bind}${req}>`);
  if (type.includes('[]') || type.includes('array') || type.includes('list')) {
    return wrap(`<select ${bind}${req}><option>${esc(field.example || 'Any')}</option></select>`);
  }
  if (CHOICE.test(name) || type.includes('enum')) {
    return wrap(
      `<select ${bind}${req}><option>${esc(field.example || 'First')}</option><option>Second</option></select>`,
    );
  }
  if (LONG_TEXT.test(name)) {
    return wrap(`<textarea ${bind}${req} rows="3" placeholder="${esc(field.example)}"></textarea>`);
  }
  if (SECRET.test(name)) {
    return wrap(`<input type="password" ${bind}${req} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022">`);
  }
  if (type.includes('file') || type.includes('image') || type.includes('upload')) {
    return wrap(`<input type="file" ${bind}${req}>`);
  }
  return wrap(`<input ${bind}${req} placeholder="${esc(field.example)}">`);
}

/** The shape the block's `layout` hint asks for, if it asks for anything. */
function shapeHint(layout: string): 'list' | 'table' | 'grid' | 'form' | 'none' {
  const text = layout.toLowerCase();
  if (/\btable\b|\bcolumns?\b|spreadsheet/.test(text)) return 'table';
  if (/\bgrid\b|\btiles?\b|gallery|cards?/.test(text)) return 'grid';
  if (/\blist\b|\bfeed\b|\brows?\b|timeline/.test(text)) return 'list';
  if (/\bform\b|wizard|checkout|sign[- ]?(in|up)|login/.test(text)) return 'form';
  return 'none';
}

/** A card standing in for a repeated record. */
function recordCard(label: string): string {
  return `    <article class="card row">
      <span class="avatar"></span>
      <div class="col grow">
        <strong class="text-heading-sm">${esc(label)}</strong>
        <span class="muted text-body-sm">Supporting line</span>
      </div>
      <span class="badge">Active</span>
    </article>`;
}

/**
 * Read a `ui_screen` block as a starting wireframe.
 *
 * Everything drawn comes from something the block already says, and every hook
 * the block knows about is carried onto the element that owns it — an action's
 * `calls` becomes the button's `data-action`, a state field becomes a bound
 * control. Nothing is invented except the arrangement.
 *
 * What comes out is a real page rather than a diagram of one: semantic tags
 * against the shared stylesheet, so even the seeded version is something the
 * user could put in front of somebody without apologising for it first.
 */
export function seedScreenHtml(block: Block, diagram: Diagram): string {
  if (block.type === 'ui_component') return seedComponentHtml(block as BlockOf<'ui_component'>);
  if (block.type !== 'ui_screen') return emptyScreenHtml();

  const data = (block as BlockOf<'ui_screen'>).data;
  const shape = shapeHint(`${data.layout} ${data.purpose} ${block.name}`);
  const content: string[] = [];

  if (data.purpose || block.summary) {
    content.push(`  <p class="muted">${esc(data.purpose || block.summary)}</p>`);
  }

  // Components the block names are instances, not copies — pointing at the
  // block means changing the component later changes it on every screen.
  const byName = new Map(diagram.blocks.map((b) => [b.name.toLowerCase(), b]));
  for (const name of data.components) {
    const target = byName.get(name.toLowerCase());
    content.push(`  <div class="card" data-component="${esc(target?.id ?? '')}">${esc(name)}</div>`);
  }

  // The state the screen holds is the state it has to capture or show.
  const fields = data.state;
  if (fields.length) {
    const tag = shape === 'form' || fields.length > 1 ? 'form' : 'div';
    content.push(`  <${tag} class="col">\n${fields.map(controlFor).join('\n')}\n  </${tag}>`);
  }

  if (shape === 'table') {
    const columns = fields.length
      ? fields.slice(0, 4).map((f) => humanize(f.name))
      : ['Name', 'Status', 'Updated'];
    content.push(
      `  <table data-repeat="${esc(block.name)}" data-repeat-count="5">
    <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody><tr>${columns.map(() => '<td>\u2014</td>').join('')}</tr></tbody>
  </table>`,
    );
  } else if (shape === 'grid') {
    content.push(
      `  <div class="grid" data-repeat="${esc(block.name)}" data-repeat-count="6">\n${recordCard('Item')}\n  </div>`,
    );
  } else if (shape === 'list') {
    content.push(
      `  <div class="col" data-repeat="${esc(block.name)}" data-repeat-count="3">\n${recordCard('Item')}\n  </div>`,
    );
  }

  // Actions become the buttons, already carrying what they call. A navigation
  // edge out of this screen says where the first one goes.
  if (data.actions.length) {
    const navEdge = diagram.edges.find(
      (edge) => edge.source === block.id && edge.type === 'navigation',
    );
    const target = navEdge ? diagram.blocks.find((b) => b.id === navEdge.target) : undefined;

    const buttons = data.actions.map((action, index) => {
      const does = action.calls || action.description;
      const goes = index === 0 && target ? ` data-navigates-to="${esc(target.name)}"` : '';
      const primary = index === 0 ? ' primary' : '';
      return `    <button class="btn${primary}" data-action="${esc(does)}"${goes}>${esc(action.name)}</button>`;
    });
    content.push(
      `  <div class="row" style="justify-content: flex-end">\n${buttons.join('\n')}\n  </div>`,
    );
  }

  if (!content.length) content.push('  <p class="muted">Nothing designed yet.</p>');

  const account = data.permissions.length ? '\n    <span class="avatar"></span>' : '';
  return `<main class="screen">
  <header class="topbar">
    <h1 class="text-heading-lg grow">${esc(block.name)}</h1>${account}
  </header>
${content.join('\n')}
</main>`;
}

/** A `ui_component` block as a wireframe: its props, its buttons. */
function seedComponentHtml(block: BlockOf<'ui_component'>): string {
  const parts: string[] = [`  <strong class="text-heading-sm">${esc(block.name)}</strong>`];

  if (block.data.purpose || block.summary) {
    parts.push(`  <p class="muted text-body-sm">${esc(block.data.purpose || block.summary)}</p>`);
  }
  for (const prop of block.data.props) {
    parts.push(
      `  <p class="text-body-sm" data-binding="props.${esc(prop.name)}">` +
        `${esc(humanize(prop.name))}: ${esc(prop.example || prop.type)}</p>`,
    );
  }
  for (const emit of block.data.emits) {
    parts.push(
      `  <button class="btn" data-action="${esc(emit.description || `emits ${emit.name}`)}">` +
        `${esc(humanize(emit.name))}</button>`,
    );
  }
  return `<article class="card col">\n${parts.join('\n')}\n</article>`;
}


/** Screens get a screen-sized frame; components get a small one. */
function deviceFor(block: Block, diagram: Diagram): Device {
  if (block.type === 'ui_component') return 'custom';
  const stack = `${diagram.techStack.frontend} ${diagram.techStack.notes}`.toLowerCase();
  if (/\b(react[- ]?native|expo|flutter|swiftui|ios|android|mobile)\b/.test(stack)) return 'mobile';
  return 'desktop';
}

function frameFor(block: Block, device: Device): { width: number; height: number } {
  if (block.type === 'ui_component') return { width: 480, height: 320 };
  const preset = DEVICE_FRAMES[device];
  return { width: preset.width, height: preset.height };
}

/** Build the design for one block, seeded from what the block already says. */
export function seedScreen(block: Block, diagram: Diagram, order = 0): ScreenDesign {
  const device = deviceFor(block, diagram);
  const route = block.type === 'ui_screen' ? (block as BlockOf<'ui_screen'>).data.route : '';
  const purpose =
    block.type === 'ui_screen'
      ? (block as BlockOf<'ui_screen'>).data.purpose || block.summary
      : block.summary;

  return createScreen({
    name: block.name,
    blockId: block.id,
    route,
    purpose,
    device,
    frame: frameFor(block, device),
    html: seedScreenHtml(block, diagram),
    order,
  });
}

/* ------------------------------------------------------------------ *
 * Derive, reconcile, diff
 * ------------------------------------------------------------------ */

/** A fresh design document for a diagram: one seeded screen per UI block. */
export function deriveDesign(diagram: Diagram): DesignDocument {
  const blocks = designableBlocks(diagram);
  const document = createDesignDocument({
    slug: diagram.slug,
    name: diagram.name,
    diagramId: diagram.id,
    screens: blocks.map((block, index) => seedScreen(block, diagram, index)),
  });
  return { ...layoutDesign(document), syncedAt: nowIso() };
}

export interface ReconcileDesignResult {
  document: DesignDocument;
  /** Screens seeded for blocks that had none. */
  added: string[];
  /** Screens whose name, route or purpose was refreshed from the diagram. */
  updated: string[];
  /** Screens whose block has been deleted from the diagram. */
  orphaned: string[];
}

/**
 * Bring a design document up to date with the diagram without losing work.
 *
 * New UI blocks get a seeded screen. Screens nobody has touched track their
 * block's name, route and purpose. Screens somebody *has* touched keep their
 * wording, and a screen whose block has gone is flagged rather than deleted —
 * losing an afternoon's design to a block someone removed by accident is not
 * a trade this should ever make.
 */
export function reconcileDesign(diagram: Diagram, document: DesignDocument): ReconcileDesignResult {
  const blocks = designableBlocks(diagram);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const covered = new Set(
    document.screens.map((screen) => screen.blockId).filter((id): id is string => Boolean(id)),
  );

  const added: string[] = [];
  const updated: string[] = [];
  const orphaned: string[] = [];

  const screens = document.screens.map((screen) => {
    if (!screen.blockId) return screen;
    const block = byId.get(screen.blockId);
    if (!block) {
      if (!screen.orphaned) orphaned.push(screen.name);
      return { ...screen, orphaned: true };
    }

    const route = block.type === 'ui_screen' ? (block as BlockOf<'ui_screen'>).data.route : screen.route;
    const purpose =
      block.type === 'ui_screen'
        ? (block as BlockOf<'ui_screen'>).data.purpose || block.summary
        : block.summary;

    // A screen somebody has worded themselves keeps its wording; only the
    // route follows the diagram, because that is the diagram's to decide.
    const next: ScreenDesign = {
      ...screen,
      orphaned: false,
      route,
      name: screen.edited ? screen.name : block.name,
      purpose: screen.edited ? screen.purpose : purpose,
    };
    if (
      next.name !== screen.name ||
      next.route !== screen.route ||
      next.purpose !== screen.purpose ||
      next.orphaned !== screen.orphaned
    ) {
      updated.push(next.name);
    }
    return next;
  });

  let order = screens.length;
  for (const block of blocks) {
    if (covered.has(block.id)) continue;
    screens.push(seedScreen(block, diagram, order++));
    added.push(block.name);
  }

  const next = layoutDesign({
    ...document,
    name: document.name || diagram.name,
    diagramId: document.diagramId || diagram.id,
    screens,
    syncedAt: nowIso(),
    updatedAt: nowIso(),
  });

  return { document: next, added, updated, orphaned };
}

export interface DesignDiff {
  /** UI blocks in the diagram with no design at all. */
  undesigned: { id: string; name: string; type: BlockType }[];
  /** Designs whose block has been deleted. */
  orphaned: { id: string; name: string }[];
  /** Designs added here that do not stand for a block. */
  unlinked: { id: string; name: string }[];
  /** Designs whose route or purpose no longer matches the block. */
  stale: { id: string; name: string; field: string; from: string; to: string }[];
  hasChanges: boolean;
}

/** What the diagram has that the designs do not, and the other way round. */
export function diffDesign(diagram: Diagram, document: DesignDocument): DesignDiff {
  const blocks = designableBlocks(diagram);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const covered = new Set(
    document.screens.map((screen) => screen.blockId).filter((id): id is string => Boolean(id)),
  );

  const undesigned = blocks
    .filter((block) => !covered.has(block.id))
    .map((block) => ({ id: block.id, name: block.name, type: block.type }));

  const orphaned: DesignDiff['orphaned'] = [];
  const unlinked: DesignDiff['unlinked'] = [];
  const stale: DesignDiff['stale'] = [];

  for (const screen of document.screens) {
    if (!screen.blockId) {
      unlinked.push({ id: screen.id, name: screen.name });
      continue;
    }
    const block = byId.get(screen.blockId);
    if (!block) {
      orphaned.push({ id: screen.id, name: screen.name });
      continue;
    }
    if (block.type !== 'ui_screen') continue;
    const data = (block as BlockOf<'ui_screen'>).data;
    if (data.route && data.route !== screen.route) {
      stale.push({ id: screen.id, name: screen.name, field: 'route', from: screen.route, to: data.route });
    }
    if (!screen.edited && block.name !== screen.name) {
      stale.push({ id: screen.id, name: screen.name, field: 'name', from: screen.name, to: block.name });
    }
  }

  return {
    undesigned,
    orphaned,
    unlinked,
    stale,
    hasChanges: Boolean(undesigned.length || orphaned.length || stale.length),
  };
}

/** What a `set_tree` needs to look right — the holes worth chasing. */
export interface DesignProgress {
  screens: number;
  todo: number;
  drafted: number;
  approved: number;
  /** Percentage of designable blocks with a design that is past `todo`. */
  completion: number;
  elements: number;
  /** Buttons that neither call anything nor go anywhere. */
  danglingActions: { screen: string; element: string }[];
  /** Controls capturing something with nowhere to put it. */
  unboundFields: { screen: string; element: string }[];
}

export function designProgress(diagram: Diagram, document: DesignDocument): DesignProgress {
  const designable = designableBlocks(diagram).length;
  const linked = new Set(
    document.screens
      .filter((s) => s.blockId && s.status !== 'todo' && !s.orphaned)
      .map((s) => s.blockId),
  );

  const danglingActions: DesignProgress['danglingActions'] = [];
  const unboundFields: DesignProgress['unboundFields'] = [];
  let elements = 0;

  // The two holes worth chasing, now that the format cannot enforce them.
  //
  // A typed tree could promise a `button` had an `action` because the schema
  // said so; markup cannot, so these checks stop being a nicety and become the
  // safety net. Both read as plainly as the selector they are: something you
  // press that neither calls nor goes anywhere, and something you type into
  // with nowhere to put the value.
  const PRESSABLE = new Set(['button', 'a']);
  const FIELDS = new Set(['input', 'textarea', 'select']);

  for (const screen of document.screens) {
    for (const element of walkScreen(screen.html)) {
      elements += 1;
      const facts = factsOf(element);

      if (PRESSABLE.has(facts.tag) && !facts.action.trim() && !facts.navigatesTo.trim()) {
        danglingActions.push({ screen: screen.name, element: facts.label });
      }
      // A submit button is an `input` in name only, and a checkbox inside a
      // row of filters is as much a field as a text box.
      const inputKind = facts.tag === 'input' ? getAttr(element, 'type').toLowerCase() : '';
      const isField = FIELDS.has(facts.tag) && !['submit', 'button', 'reset'].includes(inputKind);
      if (isField && !facts.binding.trim()) {
        unboundFields.push({ screen: screen.name, element: facts.label });
      }
    }
  }

  return {
    screens: document.screens.length,
    todo: document.screens.filter((s) => s.status === 'todo').length,
    drafted: document.screens.filter((s) => s.status === 'drafted').length,
    approved: document.screens.filter((s) => s.status === 'approved').length,
    completion: designable ? Math.round((linked.size / designable) * 100) : 0,
    elements,
    danglingActions,
    unboundFields,
  };
}
