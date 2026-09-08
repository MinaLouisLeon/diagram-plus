import { z } from 'zod';
import { PositionSchema, SizeSchema } from './common.js';
import { legacyTreeToHtml } from './design-legacy.js';

/**
 * The design document.
 *
 * The diagram says what the application is; the client view says it in plain
 * words. This is the third document: what each screen actually looks like.
 *
 * A screen is HTML and CSS. It was a typed tree of elements until version 2,
 * on the theory that markup would round-trip badly — but the tree could only
 * be drawn with chrome the editor invented for it, and a table drawn as five
 * grey dashes is a wireframe. These get shown to a client to win the work, so
 * the browser lays them out and what the client sees is what gets built.
 *
 * What the tree gave for nothing, and markup has to earn, is *meaning*: a
 * `button` was provably a button with an action because the schema said so.
 * Now the tag carries the kind and `data-*` carries the rest — `data-binding`,
 * `data-action`, `data-navigates-to` — so the implementation spec is still
 * read out of a screen rather than guessed at. `design-html.ts` is the only
 * door in, and nothing reaches a document without going through it.
 *
 * Nothing in here is a stylesheet either. The design system compiles to CSS
 * custom properties — `var(--color-accent)`, `var(--radius-md)` — so a screen
 * still says "the accent colour" rather than `#2563eb`, and changing a token
 * still restyles thirty screens at once. That was the tree's best property and
 * it survives the move intact.
 *
 * Designs live beside the diagram as `.diagrams/<slug>.design.json` rather
 * than inside it: a screen tree is an order of magnitude larger than the graph
 * it belongs to, and burying one in the other would make every diagram diff
 * unreadable.
 */

export const DESIGN_FORMAT_VERSION = 2;

/* ------------------------------------------------------------------ *
 * Tokens — the design system
 * ------------------------------------------------------------------ */

export const ColorTokenSchema = z.object({
  /** Token name as elements refer to it, e.g. `accent`, `surface.raised`. */
  name: z.string().min(1),
  /** Any CSS colour. Hex is what Claude should write. */
  value: z.string().default('#000000'),
  /** Readable colour for text sitting on top of this one. */
  on: z.string().default(''),
  description: z.string().default(''),
});
export type ColorToken = z.infer<typeof ColorTokenSchema>;

export const TypeTokenSchema = z.object({
  /** e.g. `heading.lg`, `body.md`, `caption`. */
  name: z.string().min(1),
  family: z.string().default(''),
  /** Pixels. */
  size: z.number().positive().default(16),
  weight: z.number().int().min(100).max(900).default(400),
  /** A multiple of the font size, not pixels. */
  lineHeight: z.number().positive().default(1.5),
  /** Pixels, may be negative. */
  letterSpacing: z.number().default(0),
  transform: z.enum(['none', 'uppercase', 'capitalize']).default('none'),
  description: z.string().default(''),
});
export type TypeToken = z.infer<typeof TypeTokenSchema>;

/** A named number: a radius, a shadow, a border. Value is raw CSS. */
export const NamedValueSchema = z.object({
  name: z.string().min(1),
  value: z.string().default(''),
  description: z.string().default(''),
});
export type NamedValue = z.infer<typeof NamedValueSchema>;

export const DesignSystemSchema = z.object({
  name: z.string().default(''),
  /**
   * The feel of the product, in a line. Claude writes it first and designs
   * every screen against it, which is what stops eight screens from being
   * eight unrelated opinions.
   */
  voice: z.string().default(''),
  colors: z.array(ColorTokenSchema).default([]),
  typography: z.array(TypeTokenSchema).default([]),
  /** Base spacing step in pixels; gaps and padding are multiples of it. */
  spacingBase: z.number().positive().default(8),
  radii: z.array(NamedValueSchema).default([]),
  shadows: z.array(NamedValueSchema).default([]),
  /** Anything else the implementer needs: icon set, motion, grid rules. */
  notes: z.string().default(''),
});
export type DesignSystem = z.infer<typeof DesignSystemSchema>;

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

/**
 * What a box on a screen can be.
 *
 * Deliberately a closed list of things that exist in real interfaces, not a
 * set of shapes. A designer who wants a rounded rectangle with text in it is
 * describing a `card` or a `button`, and saying which one is the entire value
 * of drawing the screen here rather than in a drawing tool.
 */
export const ELEMENT_TYPES = [
  // structure
  'frame',
  'stack',
  'grid',
  'card',
  'form',
  'nav',
  'header',
  'footer',
  'sidebar',
  'modal',
  'tabs',
  'list',
  'table',
  // content
  'text',
  'heading',
  'image',
  'icon',
  'avatar',
  'badge',
  'divider',
  'spacer',
  'chart',
  'map',
  'video',
  // controls
  'button',
  'link',
  'input',
  'textarea',
  'select',
  'checkbox',
  'radio',
  'toggle',
  'slider',
  'search',
  'upload',
  // reuse
  'component',
] as const;

export const ElementTypeSchema = z.enum(ELEMENT_TYPES);
export type ElementType = z.infer<typeof ElementTypeSchema>;

export const BoxSchema = z.object({
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
  left: z.number().default(0),
});
export type Box = z.infer<typeof BoxSchema>;

/**
 * Size, as a layout intent rather than a number.
 *
 * `fill` means take the space going; `hug` means be as big as the contents;
 * anything else is read as pixels. Three words instead of a pile of CSS, and
 * they survive being turned into flexbox, SwiftUI or Compose.
 */
export const SizingSchema = z.union([z.literal('fill'), z.literal('hug'), z.number()]);
export type Sizing = z.infer<typeof SizingSchema>;

export const DesignLayoutSchema = z.object({
  /** How children are laid out. Ignored by elements that have none. */
  direction: z.enum(['row', 'column']).default('column'),
  /** Gap between children, in pixels. */
  gap: z.number().min(0).default(0),
  padding: BoxSchema.default({ top: 0, right: 0, bottom: 0, left: 0 }),
  align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).default('stretch'),
  justify: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']).default('start'),
  wrap: z.boolean().default(false),
  /** For `grid` — how many columns. 0 means "let it flow". */
  columns: z.number().int().min(0).default(0),
  width: SizingSchema.default('fill'),
  height: SizingSchema.default('hug'),
  /**
   * Free placement, in pixels from the parent's top-left. Only honoured when
   * the parent is a `frame` — everything else is a flow, on purpose, because
   * an absolutely positioned design is not implementable as a responsive one,
   * and because whoever writes the coordinates is guessing how tall the thing
   * above came out. `settleFreePlacement` drops it everywhere else, and the
   * canvas will not draw it either.
   */
  x: z.number().default(0),
  y: z.number().default(0),
  absolute: z.boolean().default(false),
  /** Take a share of the leftover space along the parent's direction. */
  grow: z.number().min(0).default(0),
});
export type DesignLayout = z.infer<typeof DesignLayoutSchema>;

export const DesignStyleSchema = z.object({
  /** Typography token name, e.g. `heading.lg`. */
  text: z.string().default(''),
  /** Colour token name, or any raw CSS colour. */
  color: z.string().default(''),
  background: z.string().default(''),
  /** Colour token or raw colour for the border; blank means none. */
  border: z.string().default(''),
  borderWidth: z.number().min(0).default(0),
  /** Radius token name, or pixels as a number in a string. */
  radius: z.string().default(''),
  shadow: z.string().default(''),
  opacity: z.number().min(0).max(1).default(1),
  align: z.enum(['left', 'center', 'right']).default('left'),
});
export type DesignStyle = z.infer<typeof DesignStyleSchema>;

/** One choice in a `select`, `tabs`, `radio` group or `nav`. */
export const OptionSchema = z.object({
  label: z.string().default(''),
  value: z.string().default(''),
  /** Screen this option leads to, by block id or screen name. */
  navigatesTo: z.string().default(''),
  selected: z.boolean().default(false),
});
export type DesignOption = z.infer<typeof OptionSchema>;

/** Draw this subtree once per record, so a list looks like a list. */
export const RepeatSchema = z.object({
  /** What is being listed: a data model name, or plain words. */
  over: z.string().default(''),
  /** How many to draw in the mockup. */
  count: z.number().int().min(0).max(24).default(3),
});
export type DesignRepeat = z.infer<typeof RepeatSchema>;

const ElementBase = z.object({
  id: z.string().min(1),
  type: ElementTypeSchema.default('frame'),
  /** Layer name. Blank falls back to the type's label in the editor. */
  name: z.string().default(''),

  /* ---- what it says ---- */
  /** The words on it: a label, a heading, the text of a paragraph. */
  text: z.string().default(''),
  /** Field label, shown above or beside a control. */
  label: z.string().default(''),
  placeholder: z.string().default(''),
  /** The small grey line under a field. */
  helper: z.string().default(''),
  /** Emphasis, per type: `primary` | `secondary` | `ghost` | `danger` … */
  variant: z.string().default(''),
  /** Icon name or a single emoji. */
  icon: z.string().default(''),
  /** What an image or video shows. A description, never a file. */
  src: z.string().default(''),
  alt: z.string().default(''),
  options: z.array(OptionSchema).default([]),
  /** Column headings for a `table`. */
  columns: z.array(z.string()).default([]),
  repeat: RepeatSchema.nullable().default(null),

  /* ---- how it looks ---- */
  layout: DesignLayoutSchema.default({}),
  style: DesignStyleSchema.default({}),

  /* ---- what it means ---- */
  /**
   * Where the value comes from. `state.email` points at the screen block's
   * state; `Order.total` points at a field on a data model in the diagram.
   * This is the line that turns a mockup into a thing you can build.
   */
  binding: z.string().default(''),
  /**
   * What using it does. Name the block it reaches — an `api_endpoint`, a
   * `service` — so the implementer does not have to guess the wiring.
   */
  action: z.string().default(''),
  /** Where it goes: a `ui_screen` block, by id or name. */
  navigatesTo: z.string().default(''),
  /** Only drawn when this holds, e.g. "the basket is empty". */
  visibleWhen: z.string().default(''),
  /** For `component` — the `ui_component` block this instantiates. */
  componentId: z.string().default(''),

  /* ---- state ---- */
  required: z.boolean().default(false),
  disabled: z.boolean().default(false),
  hidden: z.boolean().default(false),
  /** Stops the canvas selecting or moving it — for backgrounds and chrome. */
  locked: z.boolean().default(false),
  notes: z.string().default(''),
});

export type DesignElement = z.infer<typeof ElementBase> & { children: DesignElement[] };
export type DesignElementInput = z.input<typeof ElementBase> & {
  children?: DesignElementInput[];
};

/**
 * The element tree.
 *
 * `z.lazy` on the children alone rather than on the whole schema, so the
 * result is still a `ZodObject` and `.extend`/`.partial` keep working for the
 * operation schemas built on top of it.
 */
export const DesignElementSchema: z.ZodType<DesignElement, z.ZodTypeDef, DesignElementInput> =
  ElementBase.extend({
    children: z.lazy(() => z.array(DesignElementSchema).default([])),
  }) as unknown as z.ZodType<DesignElement, z.ZodTypeDef, DesignElementInput>;

/* ------------------------------------------------------------------ *
 * Screens
 * ------------------------------------------------------------------ */

/** Frame presets. The numbers are the ones people actually design against. */
export const DEVICE_FRAMES = {
  mobile: { width: 390, height: 844, label: 'Mobile' },
  tablet: { width: 834, height: 1112, label: 'Tablet' },
  desktop: { width: 1440, height: 900, label: 'Desktop' },
  wide: { width: 1920, height: 1080, label: 'Wide' },
  custom: { width: 800, height: 600, label: 'Custom' },
} as const;

export const DeviceSchema = z.enum(['mobile', 'tablet', 'desktop', 'wide', 'custom']);
export type Device = z.infer<typeof DeviceSchema>;

/**
 * A state the screen can be in that is not worth a whole artboard: what
 * changes while it loads, when there is nothing to show, when it fails.
 * Words rather than a second tree, because that is how it reaches the spec.
 */
export const ScreenStateSchema = z.object({
  name: z.string().default(''),
  when: z.string().default(''),
  changes: z.string().default(''),
});
export type ScreenState = z.infer<typeof ScreenStateSchema>;

export const SCREEN_STATUSES = ['todo', 'drafted', 'approved'] as const;
export const ScreenStatusSchema = z.enum(SCREEN_STATUSES);
export type ScreenStatus = z.infer<typeof ScreenStatusSchema>;

export const ScreenDesignSchema = z.object({
  id: z.string().min(1),
  /**
   * The `ui_screen` (or `ui_component`) block this draws. Null for a screen
   * sketched here before anybody decided it was real — the same allowance the
   * client view makes, and for the same reason.
   */
  blockId: z.string().nullable().default(null),
  name: z.string().default(''),
  /**
   * Which take on the screen this is. Blank is the main one; `Empty`,
   * `Error`, `Signed out` are separate artboards for the same block.
   */
  variant: z.string().default(''),
  route: z.string().default(''),
  purpose: z.string().default(''),
  device: DeviceSchema.default('desktop'),
  frame: SizeSchema.default({ width: 1440, height: 900 }),
  /** Where the artboard sits on the design canvas. */
  position: PositionSchema.default({ x: 0, y: 0 }),
  /** Colour token or raw colour behind the whole screen. */
  background: z.string().default(''),
  /**
   * The screen itself, as markup.
   *
   * Every element carries a `data-el` so the editor can address it, and the
   * contract it used to carry in typed fields is on `data-binding`,
   * `data-action`, `data-navigates-to` and their neighbours.
   */
  html: z.string().default(''),
  /** CSS for this screen alone, applied after the document stylesheet. */
  css: z.string().default(''),
  states: z.array(ScreenStateSchema).default([]),
  /** Reading order — which screen the walkthrough covers first. */
  order: z.number().int().default(0),
  status: ScreenStatusSchema.default('todo'),
  /** True once a person moved the artboard, so auto-layout leaves it alone. */
  pinned: z.boolean().default(false),
  /** Someone edited the wording here, so a re-derive must not overwrite it. */
  edited: z.boolean().default(false),
  /** Its block has gone from the diagram. Kept so the loss is visible. */
  orphaned: z.boolean().default(false),
  notes: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type ScreenDesign = z.infer<typeof ScreenDesignSchema>;
export type ScreenDesignInput = z.input<typeof ScreenDesignSchema>;

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

export const DesignCanvasSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  zoom: z.number().positive().default(0.6),
});

export const DesignDocumentSchema = z.object({
  formatVersion: z.number().int().default(DESIGN_FORMAT_VERSION),
  /** The diagram this designs, by id — the link that survives a rename. */
  diagramId: z.string().default(''),
  slug: z.string().min(1),
  name: z.string().default(''),
  /** Increments on every persisted change; used for optimistic concurrency. */
  revision: z.number().int().nonnegative().default(0),
  system: DesignSystemSchema.default({}),
  /**
   * The stylesheet every screen is drawn against, after the tokens.
   *
   * One shared sheet rather than a copy per screen is what keeps twenty
   * screens looking like one product: a button styled once is styled
   * everywhere, and the implementer receives a stylesheet rather than twenty
   * variations on one.
   */
  css: z.string().default(''),
  screens: z.array(ScreenDesignSchema).default([]),
  canvas: DesignCanvasSchema.default({ x: 0, y: 0, zoom: 0.6 }),
  notes: z.string().default(''),
  /** When the designs were last brought into line with the diagram. */
  syncedAt: z.string().default(''),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type DesignDocument = z.infer<typeof DesignDocumentSchema>;
export type DesignDocumentInput = z.input<typeof DesignDocumentSchema>;

/** A trimmed record for listing designs without shipping every tree. */
export interface DesignSummary {
  slug: string;
  name: string;
  revision: number;
  screens: number;
  drafted: number;
  approved: number;
  updatedAt: string;
}

export function summarizeDesign(document: DesignDocument): DesignSummary {
  return {
    slug: document.slug,
    name: document.name,
    revision: document.revision,
    screens: document.screens.length,
    drafted: document.screens.filter((s) => s.status !== 'todo').length,
    approved: document.screens.filter((s) => s.status === 'approved').length,
    updatedAt: document.updatedAt,
  };
}

/**
 * Bring an older design file up to the current format. Same contract as the
 * diagram's `migrate`: read the version, apply each step, never throw.
 */
export function migrateDesign(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const doc = { ...(raw as Record<string, unknown>) };
  const version = typeof doc['formatVersion'] === 'number' ? (doc['formatVersion'] as number) : 0;

  // 1 -> 2: a screen was a typed element tree; it is HTML and CSS now. The
  // tree is translated rather than dropped, so an afternoon's design survives
  // an upgrade the user did not ask for and may not have noticed.
  if (version < 2 && Array.isArray(doc['screens'])) {
    doc['screens'] = (doc['screens'] as unknown[]).map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const screen = { ...(entry as Record<string, unknown>) };
      if (typeof screen['html'] !== 'string' && screen['root']) {
        screen['html'] = legacyTreeToHtml(screen['root']);
      }
      delete screen['root'];
      return screen;
    });
  }

  if (version < DESIGN_FORMAT_VERSION) doc['formatVersion'] = DESIGN_FORMAT_VERSION;
  return doc;
}

export function parseDesign(raw: unknown): DesignDocument {
  return DesignDocumentSchema.parse(migrateDesign(raw));
}

export function safeParseDesign(raw: unknown) {
  return DesignDocumentSchema.safeParse(migrateDesign(raw));
}
