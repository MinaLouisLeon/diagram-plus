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
