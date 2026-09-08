import { z } from 'zod';
import { ELEMENT_TYPES } from '@diagram-plus/core';

/**
 * Argument schemas for the screen-design tools.
 *
 * The element tree is an open record rather than a recursive zod schema, for
 * two reasons. MCP argument schemas are flattened into JSON Schema for the
 * model to read, and a recursive one renders as an unreadable knot of `$ref`s.
 * And the tree is properly validated by core the moment it lands, so a wire
 * schema repeating those rules would only be a second place for them to drift.
 * The vocabulary lives in the tool descriptions and in `describe_design_schema`
 * instead, where a reader will actually find it.
 */

export const screenRef = z
  .string()
  .describe(
    'Screen to act on: its exact name, "Name / Variant" when it has variants, its id, or the ' +
      'id of the ui_screen block it draws.',
  );

export const elementRef = z
  .string()
  .describe('Element to act on: its layer name within the screen, or its id.');

export const elementTypeEnum = z.enum(ELEMENT_TYPES);

export const deviceEnum = z
  .enum(['mobile', 'tablet', 'desktop', 'wide', 'custom'])
  .describe('Frame preset: mobile 390×844, tablet 834×1112, desktop 1440×900, wide 1920×1080.');

/** One box on a screen. Nested `children` build the tree. */
export const elementTreeSchema = z
  .record(z.any())
  .describe(
    'An element: { type, children[], and any of text, label, placeholder, helper, variant, ' +
      'icon, src, alt, options, columns, repeat, binding, action, navigatesTo, visibleWhen, ' +
      'required, disabled, layout, style, name, notes }. Ids are minted for you, and anything ' +
      'left out takes that type’s default — so a button needs only its text and what it does.',
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
    root: elementTreeSchema.optional().describe('The whole layout, as one nested element.'),
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
    op: z.literal('set_tree'),
    screen: screenRef,
    root: elementTreeSchema.describe('Replaces the screen’s whole layout.'),
  }),
  z.object({
    op: z.literal('add_element'),
    screen: screenRef,
    type: elementTypeEnum,
    parent: elementRef.optional().describe('Container to put it in. Defaults to the screen root.'),
    index: z.number().int().optional().describe('Position among its siblings. Defaults to last.'),
    props: z.record(z.any()).optional().describe('Any element property — see set_tree.'),
    children: z.array(elementTreeSchema).optional().describe('A whole subtree beneath it.'),
  }),
  z.object({
    op: z.literal('update_element'),
    screen: screenRef,
    element: elementRef,
    type: elementTypeEnum.optional().describe('Retype it, keeping its words and its children.'),
    name: z.string().optional().describe('Layer name.'),
    text: z.string().optional(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    helper: z.string().optional(),
    variant: z.string().optional(),
    icon: z.string().optional(),
    src: z.string().optional(),
    alt: z.string().optional(),
    options: z.array(z.record(z.any())).optional(),
    columns: z.array(z.string()).optional(),
    repeat: z.record(z.any()).nullable().optional(),
    layout: z.record(z.any()).optional().describe('Merged over the current layout.'),
    style: z.record(z.any()).optional().describe('Merged over the current style.'),
    binding: z.string().optional(),
    action: z.string().optional(),
    navigatesTo: z.string().optional(),
    visibleWhen: z.string().optional(),
    componentId: z.string().optional(),
    required: z.boolean().optional(),
    disabled: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    notes: z.string().optional(),
  }),
  z.object({ op: z.literal('remove_element'), screen: screenRef, element: elementRef }),
  z.object({ op: z.literal('duplicate_element'), screen: screenRef, element: elementRef }),
  z.object({
    op: z.literal('move_element'),
    screen: screenRef,
    element: elementRef,
    parent: elementRef.describe('The container to move it into.'),
    index: z.number().int().optional(),
  }),
  z.object({ op: z.literal('set_system'), system: designSystemSchema }),
  z.object({
    op: z.literal('set_notes'),
    notes: z.string().describe('Free text kept with the designs.'),
  }),
]);
