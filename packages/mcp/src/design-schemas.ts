import { z } from 'zod';

/**
 * Argument schemas for the screen-design tools.
 *
 * A screen arrives as a string of HTML, which is a far better wire format than
 * the open record the element tree needed: there is nothing to flatten into
 * JSON Schema, nothing to validate twice, and a model writing it is writing the
 * thing it is best at rather than a bespoke JSON dialect.
 *
 * What the markup has to *carry* — the bindings, the actions, the destinations
 * — is not enforceable by a wire schema either way. It lives in the tool
 * descriptions, in `describe_design_schema`, and in the checks `design_progress`
 * runs, which is where a reader will actually find it.
 */

export const screenRef = z
  .string()
  .describe(
    'Screen to act on: its exact name, "Name / Variant" when it has variants, its id, or the ' +
      'id of the ui_screen block it draws.',
  );

export const elementRef = z
  .string()
  .describe(
    'Element to act on: its data-el id, the exact words on it, or its tag when the screen has ' +
      'only one.',
  );

export const deviceEnum = z
  .enum(['mobile', 'tablet', 'desktop', 'wide', 'custom'])
  .describe('Frame preset: mobile 390×844, tablet 834×1112, desktop 1440×900, wide 1920×1080.');

/** A screen, as markup. */
export const htmlSchema = z
  .string()
  .describe(
    'The whole screen as HTML. Use semantic tags — header, nav, form, label, table, button. ' +
      'Style it with the shared stylesheet’s classes and var(--color-*) tokens, never raw hex. ' +
      'Carry the wiring on data-binding, data-action, data-navigates-to and data-repeat. ' +
      'A data-el id is minted for every element, so you never write one.',
  );

export const screenCssSchema = z
  .string()
  .optional()
  .describe(
    'CSS for this screen alone, on top of the shared stylesheet. Leave it out unless the screen ' +
      'genuinely needs something of its own — rules that belong to every screen go in the ' +
      'shared stylesheet with set_design_css.',
  );

export const screenStateSchema = z.object({
  name: z.string().describe('What the state is called, e.g. "Loading", "Empty", "Error".'),
  when: z.string().optional().describe('When the screen is in it.'),
  changes: z.string().optional().describe('What is different about it, in words.'),
});

export const designSystemSchema = z.object({
  name: z.string().optional(),
  voice: z
    .string()
    .optional()
    .describe('The feel of the product in one line. Design every screen against it.'),
  colors: z
    .array(
      z.object({
        name: z.string().describe('Token name elements refer to, e.g. accent, surface, text.'),
        value: z.string().describe('A CSS colour, normally hex.'),
        on: z.string().optional().describe('Readable colour for text sitting on this one.'),
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Replaces the whole colour list.'),
  typography: z
    .array(
      z.object({
        name: z.string().describe('Token name, e.g. heading.lg, body.md, caption.'),
        family: z.string().optional(),
        size: z.number().optional().describe('Pixels.'),
        weight: z.number().optional(),
        lineHeight: z.number().optional().describe('A multiple of the size, not pixels.'),
        letterSpacing: z.number().optional(),
        transform: z.enum(['none', 'uppercase', 'capitalize']).optional(),
        description: z.string().optional(),
      }),
    )
    .optional()
    .describe('Replaces the whole type scale.'),
  spacingBase: z.number().optional().describe('Base spacing step in pixels; gaps are multiples.'),
  radii: z
    .array(z.object({ name: z.string(), value: z.string(), description: z.string().optional() }))
    .optional(),
  shadows: z
    .array(z.object({ name: z.string(), value: z.string(), description: z.string().optional() }))
    .optional(),
  notes: z.string().optional().describe('Icon set, motion, grid — anything else that matters.'),
});

export const designOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_screen'),
    name: z.string().describe('What the screen is called.'),
    blockId: z
      .string()
      .optional()
      .describe('The ui_screen block it draws. Omit for a screen that is not a block yet.'),
    variant: z
      .string()
      .optional()
      .describe('A second artboard for the same screen, e.g. "Empty" or "Error".'),
    route: z.string().optional(),
    purpose: z.string().optional(),
    device: deviceEnum.optional(),
    background: z.string().optional().describe('Colour token behind the whole screen.'),
    html: htmlSchema.optional().describe('The whole screen, as markup.'),
    css: screenCssSchema,
    states: z.array(screenStateSchema).optional(),
    after: screenRef.optional().describe('Place it after this screen in the walkthrough.'),
  }),
  z.object({
    op: z.literal('update_screen'),
    screen: screenRef,
    name: z.string().optional(),
    variant: z.string().optional(),
    route: z.string().optional(),
    purpose: z.string().optional(),
    device: deviceEnum.optional(),
    frame: z.object({ width: z.number().optional(), height: z.number().optional() }).optional(),
    background: z.string().optional(),
    states: z.array(screenStateSchema).optional(),
    status: z
      .enum(['todo', 'drafted', 'approved'])
      .optional()
      .describe('Move to drafted once you have designed it. Approved is the user’s to set.'),
    blockId: z.string().nullable().optional(),
    notes: z.string().optional(),
  }),
  z.object({ op: z.literal('remove_screen'), screen: screenRef }),
  z.object({
    op: z.literal('duplicate_screen'),
    screen: screenRef,
    name: z.string().optional(),
    variant: z.string().optional().describe('What the copy is a variant of, e.g. "Empty".'),
  }),
  z.object({ op: z.literal('move_screen'), screen: screenRef, x: z.number(), y: z.number() }),
  z.object({
    op: z.literal('reorder_screens'),
    order: z.array(screenRef).describe('Screens left out keep their place at the end.'),
  }),
  z.object({
    op: z.literal('set_html'),
    screen: screenRef,
    html: htmlSchema.describe('Replaces the screen\u2019s whole markup.'),
  }),
  z.object({
    op: z.literal('set_css'),
    screen: screenRef.optional().describe('Omit for the stylesheet every screen shares.'),
    css: z.string(),
  }),
  z.object({
    op: z.literal('insert_html'),
    screen: screenRef,
    html: z.string().describe('The markup to add.'),
    target: elementRef.optional().describe('What to place it against. Defaults to the outermost element.'),
    where: z.enum(['inside', 'before', 'after']).optional().describe('Defaults to inside.'),
    index: z.number().int().optional().describe('Position among the target\u2019s children, for inside.'),
  }),
  z.object({
    op: z.literal('set_attribute'),
    screen: screenRef,
    element: elementRef,
    name: z.string().describe('e.g. data-binding, data-action, class, placeholder, required.'),
    value: z.string().nullable().describe('Null removes it.'),
  }),
  z.object({
    op: z.literal('set_text'),
    screen: screenRef,
    element: elementRef,
    text: z.string().describe('Replaces its words, leaving anything nested inside it alone.'),
  }),
  z.object({
    op: z.literal('move_node'),
    screen: screenRef,
    element: elementRef,
    parent: elementRef,
    index: z.number().int().optional(),
  }),
  z.object({ op: z.literal('remove_node'), screen: screenRef, element: elementRef }),
  z.object({ op: z.literal('duplicate_node'), screen: screenRef, element: elementRef }),
  z.object({ op: z.literal('set_system'), system: designSystemSchema }),
  z.object({
    op: z.literal('set_notes'),
    notes: z.string().describe('Free text kept with the designs.'),
  }),
]);
