import type { Block, BlockOf, BlockType } from './blocks.js';
import type { Field } from './common.js';
import type { Diagram } from './diagram.js';
import {
  createDesignDocument,
  createElement,
  createScreen,
  emptyScreenRoot,
} from './design-factory.js';
import { layoutDesign, walkElements } from './design-ops.js';
import {
  DEVICE_FRAMES,
  type DesignDocument,
  type DesignElement,
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

/** The control a piece of screen state should be captured with. */
function controlFor(field: Field): DesignElement {
  const type = field.type.toLowerCase();
  const name = field.name;

  const common = {
    name: field.name,
    label: humanize(field.name),
    helper: field.description,
    binding: `state.${field.name}`,
    required: field.required,
    placeholder: field.example,
  };

  if (type.includes('bool')) {
    return createElement('checkbox', { ...common, placeholder: '' });
  }
  if (type.includes('[]') || type.includes('array') || type.includes('list')) {
    return createElement('select', { ...common, options: [{ label: field.example || 'Any' }] });
  }
  if (CHOICE.test(name) || type.includes('enum')) {
    return createElement('select', {
      ...common,
      placeholder: field.example || 'Choose one',
      options: [{ label: field.example || 'First' }, { label: 'Second' }],
    });
  }
  if (LONG_TEXT.test(name)) {
    return createElement('textarea', common);
  }
  if (SECRET.test(name)) {
    return createElement('input', { ...common, variant: 'password', placeholder: '••••••••' });
  }
  if (type.includes('file') || type.includes('image') || type.includes('upload')) {
    return createElement('upload', { ...common, placeholder: '' });
  }
  return createElement('input', common);
}

/** `firstName` / `first_name` → `First name`. */
function humanize(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
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
function recordCard(label: string): DesignElement {
  return createElement('card', {
    name: `${label} row`,
    layout: { direction: 'row', gap: 16, align: 'center' },
    children: [
      createElement('avatar', { name: 'Thumbnail' }),
      createElement('stack', {
        name: 'Detail',
        layout: { direction: 'column', gap: 4, grow: 1 },
        children: [
          createElement('text', { name: 'Title', text: label, style: { text: 'heading.sm' } }),
          createElement('text', {
            name: 'Meta',
            text: 'Supporting line',
            style: { text: 'body.sm', color: 'subtle' },
          }),
        ],
      }),
      createElement('badge', { name: 'Status', text: 'Active' }),
    ],
  }) as DesignElement;
}

/**
 * Read a `ui_screen` block as a starting wireframe.
 *
 * Everything drawn comes from something the block already says, and every
 * hook the block knows about is carried onto the element that owns it — an
 * action's `calls` becomes the button's action, a state field becomes a bound
 * control. Nothing is invented except the arrangement.
 */
export function seedScreenRoot(block: Block, diagram: Diagram): DesignElement {
  if (block.type === 'ui_component') return seedComponentRoot(block as BlockOf<'ui_component'>);
  if (block.type !== 'ui_screen') return emptyScreenRoot();

  const data = (block as BlockOf<'ui_screen'>).data;
  const shape = shapeHint(`${data.layout} ${data.purpose} ${block.name}`);
  const content: DesignElement[] = [];

  if (data.purpose || block.summary) {
    content.push(
      createElement('text', {
        name: 'Purpose',
        text: data.purpose || block.summary,
        style: { text: 'body.md', color: 'subtle' },
      }),
    );
  }

  // Components the block names are instances, not copies — pointing at the
  // block means changing the component later changes it on every screen.
  const byName = new Map(diagram.blocks.map((b) => [b.name.toLowerCase(), b]));
  for (const name of data.components) {
    const target = byName.get(name.toLowerCase());
    content.push(
      createElement('component', {
        name,
        text: name,
        componentId: target?.id ?? '',
      }),
    );
  }

  // The state the screen holds is the state it has to capture or show.
  const fields = data.state;
  if (fields.length) {
    const controls = fields.map(controlFor);
    content.push(
      createElement(shape === 'form' || fields.length > 1 ? 'form' : 'stack', {
        name: 'Details',
        layout: { direction: 'column', gap: 16 },
        children: controls,
      }),
    );
  }

  if (shape === 'table') {
    content.push(
      createElement('table', {
        name: 'Records',
        columns: fields.length ? fields.slice(0, 4).map((f) => humanize(f.name)) : ['Name', 'Status', 'Updated'],
        repeat: { over: block.name, count: 5 },
      }),
    );
  } else if (shape === 'grid') {
    content.push(
      createElement('grid', {
        name: 'Records',
        layout: { columns: 3, gap: 16 },
        repeat: { over: block.name, count: 6 },
        children: [recordCard('Item')],
      }),
    );
  } else if (shape === 'list') {
    content.push(
      createElement('list', {
        name: 'Records',
        repeat: { over: block.name, count: 3 },
        children: [recordCard('Item')],
      }),
    );
  }

  // Actions become the buttons, already carrying what they call. A navigation
  // edge out of this screen tells us where the last one goes.
  if (data.actions.length) {
    const navTarget = diagram.edges.find(
      (edge) => edge.source === block.id && edge.type === 'navigation',
    );
    const target = navTarget
      ? diagram.blocks.find((b) => b.id === navTarget.target)
      : undefined;

    content.push(
      createElement('stack', {
        name: 'Actions',
        layout: { direction: 'row', gap: 12, justify: 'end', align: 'center' },
        children: data.actions.map((action, index) =>
          createElement('button', {
            name: action.name,
            text: action.name,
            variant: index === 0 ? 'primary' : 'secondary',
            action: action.calls || action.description,
            navigatesTo: index === 0 && target ? target.name : '',
            style:
              index === 0
                ? {}
                : { background: 'surface', color: 'text', border: 'border', borderWidth: 1 },
          }),
        ),
      }),
    );
  }

  if (!content.length) {
    content.push(
      createElement('text', {
        name: 'Placeholder',
        text: 'Nothing designed yet.',
        style: { color: 'subtle' },
      }),
    );
  }

  const header = createElement('header', {
    name: 'Header',
    children: [
      createElement('heading', { name: 'Title', text: block.name }),
      createElement('spacer', { name: 'Spacer' }),
      ...(data.permissions.length ? [createElement('avatar', { name: 'Account' })] : []),
    ],
  });

  return createElement('stack', {
    name: 'Screen',
    layout: { direction: 'column', gap: 0, width: 'fill', height: 'fill' },
    children: [
      header,
      createElement('stack', {
        name: 'Content',
        layout: {
          direction: 'column',
          gap: 24,
          padding: { top: 32, right: 32, bottom: 32, left: 32 },
          width: 'fill',
          grow: 1,
        },
        children: content,
      }),
    ],
  }) as DesignElement;
}

/** A `ui_component` block as a wireframe: its props, its buttons. */
function seedComponentRoot(block: BlockOf<'ui_component'>): DesignElement {
  const children: DesignElement[] = [
    createElement('text', {
      name: 'Title',
      text: block.name,
      style: { text: 'heading.sm' },
    }),
  ];
  if (block.data.purpose || block.summary) {
    children.push(
      createElement('text', {
        name: 'Purpose',
        text: block.data.purpose || block.summary,
        style: { text: 'body.sm', color: 'subtle' },
      }),
    );
  }
  for (const prop of block.data.props) {
    children.push(
      createElement('text', {
        name: prop.name,
        text: `${humanize(prop.name)}: ${prop.example || prop.type}`,
        style: { text: 'body.sm' },
        binding: `props.${prop.name}`,
      }),
    );
  }
  for (const emit of block.data.emits) {
    children.push(
      createElement('button', {
        name: emit.name,
        text: humanize(emit.name),
        variant: 'secondary',
        action: emit.description || `emits ${emit.name}`,
        style: { background: 'surface', color: 'text', border: 'border', borderWidth: 1 },
      }),
    );
  }
  return createElement('card', {
    name: block.name,
    layout: { direction: 'column', gap: 12, width: 'fill', height: 'hug' },
    children,
  }) as DesignElement;
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
    root: seedScreenRoot(block, diagram),
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

  for (const screen of document.screens) {
    for (const element of walkElements(screen.root)) {
      elements += 1;
      const named = element.name || element.text || element.label || element.type;
      if (
        (element.type === 'button' || element.type === 'link') &&
        !element.action.trim() &&
        !element.navigatesTo.trim()
      ) {
        danglingActions.push({ screen: screen.name, element: named });
      }
      if (
        ['input', 'textarea', 'select', 'checkbox', 'radio', 'toggle', 'slider', 'upload'].includes(
          element.type,
        ) &&
        !element.binding.trim()
      ) {
        unboundFields.push({ screen: screen.name, element: named });
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
