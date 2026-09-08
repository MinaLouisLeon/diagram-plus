import {
  ELEMENT_CATALOG,
  ELEMENT_CATEGORIES,
  ELEMENT_TYPES,
  type ElementType,
} from '@diagram-plus/core';

/**
 * Compact descriptions of the element vocabulary.
 *
 * Baked into the design tool descriptions so a screen can be written without a
 * round-trip to `describe_design_schema` first — the same bargain `hints.ts`
 * makes for block payloads.
 */

export function elementTypeLine(type: ElementType): string {
  const info = ELEMENT_CATALOG[type];
  const props = info.props.length ? ` props: ${info.props.join(', ')}` : '';
  return `- ${type}${info.container ? ' (holds children)' : ''} — ${info.description}${props}`;
}

export function allElementTypesHint(): string {
  return ELEMENT_CATEGORIES.map((category) => {
    const types = ELEMENT_TYPES.filter((type) => ELEMENT_CATALOG[type].category === category.id);
    return [`${category.label}:`, ...types.map(elementTypeLine)].join('\n');
  }).join('\n\n');
}

/** The house rules. Short, because they are repeated on several tools. */
export const DESIGN_RULES = [
  'Never set x/y or absolute. Put one thing below another by making it the next child of a ' +
    'column stack, and space it with gap and padding. You cannot know how tall a heading or a ' +
    'wrapped line renders, so guessed coordinates land elements on top of each other — and a ' +
    'screen of overlapping text is the one thing that cannot be shown to a client. Outside a ' +
    'frame they are ignored and the element is settled back into the flow.',
  'Refer to tokens (accent, surface, heading.lg, radius md), never to raw hex, unless you are defining the token itself.',
  'Write the real words. A screen full of "Lorem ipsum" or "Button" is not a design anybody can build from.',
  'Every button either calls something (action) or goes somewhere (navigatesTo). One with neither is a hole.',
  'Every field says where its value lives (binding), e.g. state.email or Order.total.',
  'Draw one row inside a list and set what it repeats over. Never paste the row out five times.',
].map((rule, index) => `${index + 1}. ${rule}`).join('\n');

/** A worked example, which is worth more than any amount of prose. */
export const DESIGN_EXAMPLE = `{
  "type": "stack",
  "layout": { "direction": "column", "gap": 24, "padding": { "top": 32, "right": 32, "bottom": 32, "left": 32 } },
  "children": [
    { "type": "heading", "text": "Welcome back", "style": { "text": "heading.lg" } },
    { "type": "text", "text": "Sign in to pick up where you left off.", "style": { "color": "subtle" } },
    { "type": "form", "action": "POST /api/session", "layout": { "gap": 16 }, "children": [
      { "type": "input", "label": "Email", "placeholder": "you@example.com", "binding": "state.email", "required": true },
      { "type": "input", "label": "Password", "variant": "password", "binding": "state.password", "required": true },
      { "type": "button", "text": "Sign in", "variant": "primary", "action": "POST /api/session", "layout": { "width": "fill" } }
    ] },
    { "type": "link", "text": "Forgot your password?", "navigatesTo": "Reset password" }
  ]
}`;

/** Full element catalog as JSON, for `describe_design_schema`. */
export function designCatalogJson(type?: ElementType) {
  const types = type ? [type] : ELEMENT_TYPES;
  return {
    elementTypes: types.map((t) => ({
      type: t,
      label: ELEMENT_CATALOG[t].label,
      category: ELEMENT_CATALOG[t].category,
      container: ELEMENT_CATALOG[t].container,
      description: ELEMENT_CATALOG[t].description,
      whenToUse: ELEMENT_CATALOG[t].whenToUse,
      props: ELEMENT_CATALOG[t].props,
      defaults: ELEMENT_CATALOG[t].defaults,
    })),
    ...(type
      ? {}
      : {
          layout: {
            direction: 'row | column',
            gap: 'pixels between children',
            padding: '{ top, right, bottom, left } in pixels',
            align: 'start | center | end | stretch | baseline (across the direction)',
            justify: 'start | center | end | between | around | evenly (along it)',
            wrap: 'boolean',
            columns: 'for grid: how many',
            width: '"fill" | "hug" | pixels',
            height: '"fill" | "hug" | pixels',
            grow: 'share of the leftover space',
            absolute:
              'free placement. Only honoured inside a frame — anywhere else it is dropped and ' +
              'the element goes back into the flow. Do not reach for it: use a stack.',
            x: 'pixels from the parent left. Only inside a frame',
            y: 'pixels from the parent top. Only inside a frame',
          },
          style: {
            text: 'a typography token name, e.g. heading.lg',
            color: 'a colour token name, or raw CSS',
            background: 'a colour token name, or raw CSS',
            border: 'a colour token name for the border',
            borderWidth: 'pixels',
            radius: 'a radius token name, e.g. md',
            shadow: 'a shadow token name',
            opacity: '0 to 1',
            align: 'left | center | right — how text sits',
          },
          meaning: {
            binding: 'where the value comes from: state.email, Order.total',
            action: 'what using it does: name the endpoint or service block it reaches',
            navigatesTo: 'the ui_screen it opens, by name or block id',
            visibleWhen: 'only drawn when this holds',
            repeat: '{ over, count } — draw this subtree once per record',
            componentId: 'for type "component": the ui_component block it instantiates',
          },
        }),
  };
}
