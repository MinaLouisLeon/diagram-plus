import { ELEMENT_TYPES, type DesignElementInput, type ElementType } from './design.js';

/**
 * A description of every element type in terms the editor and the MCP server
 * can both consume — the design-side twin of `catalog.ts`.
 *
 * `design.ts` decides what is *valid*; this file decides what is *meaningful*:
 * which of the thirty-odd properties on an element actually apply to a
 * checkbox, what a sensible new one looks like, and how to explain the
 * difference between a `stack` and a `frame` to somebody — or something —
 * placing one for the first time.
 *
 * `test/design-catalog.test.ts` asserts the two stay in sync.
 */

export type ElementCategory = 'structure' | 'content' | 'control' | 'reuse';

/** Properties an element type actually uses. The inspector shows only these. */
export type ElementProp =
  | 'text'
  | 'label'
  | 'placeholder'
  | 'helper'
  | 'variant'
  | 'icon'
  | 'src'
  | 'alt'
  | 'options'
  | 'columns'
  | 'repeat'
  | 'binding'
  | 'action'
  | 'navigatesTo'
  | 'required'
  | 'disabled'
  | 'componentId';

export interface ElementTypeInfo {
  type: ElementType;
  label: string;
  icon: string;
  category: ElementCategory;
  /** What it is, in one line. */
  description: string;
  /** When to reach for this one rather than a neighbour. */
  whenToUse: string;
  /** True when it holds other elements. */
  container: boolean;
  /** Properties that mean something here. */
  props: ElementProp[];
  /** Seed for a newly placed one, merged over the schema defaults. */
  defaults: Omit<DesignElementInput, 'id'>;
}

const NONE: ElementProp[] = [];

/** Every control carries the same handful of form properties. */
const FIELD_PROPS: ElementProp[] = [
  'label',
  'placeholder',
  'helper',
  'binding',
  'required',
  'disabled',
];

export const ELEMENT_CATALOG: Record<ElementType, ElementTypeInfo> = {
  /* ---- structure ---------------------------------------------------- */

  frame: {
    type: 'frame',
    label: 'Frame',
    icon: '▢',
    category: 'structure',
    description: 'A plain box. The only container whose children may be placed freely.',
    whenToUse:
      'A background, a panel, or the rare case where something genuinely overlaps. Prefer a ' +
      'stack — a frame with absolutely placed children cannot be built responsively.',
    container: true,
    props: NONE,
    defaults: {
      type: 'frame',
      layout: { direction: 'column', width: 'fill', height: 'hug', padding: { top: 16, right: 16, bottom: 16, left: 16 } },
    },
  },

  stack: {
    type: 'stack',
    label: 'Stack',
    icon: '≡',
    category: 'structure',
    description: 'A row or a column with a gap between its children. The workhorse.',
    whenToUse: 'Almost every grouping. Nest stacks rather than positioning anything by hand.',
    container: true,
    props: NONE,
    defaults: {
      type: 'stack',
      layout: { direction: 'column', gap: 16, width: 'fill', height: 'hug' },
    },
  },

  grid: {
    type: 'grid',
    label: 'Grid',
    icon: '▦',
    category: 'structure',
    description: 'Equal columns that wrap.',
    whenToUse: 'Cards, tiles, a gallery — anything laid out in even columns.',
    container: true,
    props: ['repeat'],
    defaults: {
      type: 'grid',
      layout: { columns: 3, gap: 16, width: 'fill', height: 'hug' },
    },
  },

  card: {
    type: 'card',
    label: 'Card',
    icon: '▤',
    category: 'structure',
    description: 'A bordered, padded surface holding one thing.',
    whenToUse: 'One item in a list or grid: a product, a summary, a setting.',
    container: true,
    props: ['navigatesTo'],
    defaults: {
      type: 'card',
      layout: { direction: 'column', gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 }, width: 'fill', height: 'hug' },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  form: {
    type: 'form',
    label: 'Form',
    icon: '🗒',
    category: 'structure',
    description: 'A group of fields submitted together.',
    whenToUse:
      'Whenever fields are submitted as one. Put the endpoint on its action, so the ' +
      'implementer knows what the submit does.',
    container: true,
    props: ['action'],
    defaults: {
      type: 'form',
      layout: { direction: 'column', gap: 16, width: 'fill', height: 'hug' },
    },
  },

  nav: {
    type: 'nav',
    label: 'Navigation',
    icon: '⇥',
    category: 'structure',
    description: 'A set of links between screens.',
    whenToUse: 'The main menu, a tab bar, breadcrumbs. Point each option at a screen.',
    container: true,
    props: ['options'],
    defaults: {
      type: 'nav',
      layout: { direction: 'row', gap: 24, align: 'center', width: 'fill', height: 'hug' },
    },
  },

  header: {
    type: 'header',
    label: 'Header',
    icon: '▀',
    category: 'structure',
    description: 'The bar across the top of the screen.',
    whenToUse: 'Title, back button, account menu — the chrome above the content.',
    container: true,
    props: NONE,
    defaults: {
      type: 'header',
      layout: {
        direction: 'row',
        gap: 16,
        align: 'center',
        justify: 'between',
        padding: { top: 16, right: 24, bottom: 16, left: 24 },
        width: 'fill',
        height: 64,
      },
      style: { background: 'surface', border: 'border', borderWidth: 1 },
    },
  },

  footer: {
    type: 'footer',
    label: 'Footer',
    icon: '▄',
    category: 'structure',
    description: 'The bar across the bottom.',
    whenToUse: 'A mobile tab bar, or the small print at the end of a page.',
    container: true,
    props: NONE,
    defaults: {
      type: 'footer',
      layout: {
        direction: 'row',
        gap: 16,
        align: 'center',
        justify: 'center',
        padding: { top: 12, right: 24, bottom: 12, left: 24 },
        width: 'fill',
        height: 64,
      },
    },
  },

  sidebar: {
    type: 'sidebar',
    label: 'Sidebar',
    icon: '▌',
    category: 'structure',
    description: 'A fixed-width column down one side.',
    whenToUse: 'Navigation or filters beside the main content.',
    container: true,
    props: NONE,
    defaults: {
      type: 'sidebar',
      layout: {
        direction: 'column',
        gap: 8,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        width: 240,
        height: 'fill',
      },
      style: { background: 'surface' },
    },
  },

  modal: {
    type: 'modal',
    label: 'Dialog',
    icon: '❐',
    category: 'structure',
    description: 'A panel over the screen, with the rest dimmed behind it.',
    whenToUse: 'A confirmation, or a short form that must be finished or abandoned.',
    container: true,
    props: NONE,
    defaults: {
      type: 'modal',
      layout: {
        direction: 'column',
        gap: 16,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        width: 420,
        height: 'hug',
      },
      style: { background: 'surface', radius: 'lg', shadow: 'lg' },
    },
  },

  tabs: {
    type: 'tabs',
    label: 'Tabs',
    icon: '⑃',
    category: 'structure',
    description: 'Switchable panes over the same area.',
    whenToUse: 'Two or three views of one thing. Beyond that, use navigation.',
    container: true,
    props: ['options'],
    defaults: {
      type: 'tabs',
      layout: { direction: 'column', gap: 0, width: 'fill', height: 'hug' },
      options: [
        { label: 'First', selected: true },
        { label: 'Second' },
      ],
    },
  },

  list: {
    type: 'list',
    label: 'List',
    icon: '☰',
    category: 'structure',
    description: 'One child, drawn once per record.',
    whenToUse:
      'Any repeating run of rows. Draw a single row inside it and set what it repeats over — ' +
      'never paste the row out five times.',
    container: true,
    props: ['repeat', 'binding'],
    defaults: {
      type: 'list',
      layout: { direction: 'column', gap: 8, width: 'fill', height: 'hug' },
      repeat: { over: '', count: 3 },
    },
  },

  table: {
    type: 'table',
    label: 'Table',
    icon: '▦',
    category: 'structure',
    description: 'Rows and columns of records.',
    whenToUse: 'Data that is compared across columns. Name the columns.',
    container: false,
    props: ['columns', 'binding', 'repeat'],
    defaults: {
      type: 'table',
      columns: ['Name', 'Status', 'Updated'],
      repeat: { over: '', count: 4 },
      layout: { width: 'fill', height: 'hug' },
    },
  },

  /* ---- content ------------------------------------------------------ */

  heading: {
    type: 'heading',
    label: 'Heading',
    icon: 'H',
    category: 'content',
    description: 'A title.',
    whenToUse: 'The name of the screen or of a section within it.',
    container: false,
    props: ['text'],
    defaults: {
      type: 'heading',
      text: 'Heading',
      style: { text: 'heading.lg', color: 'text' },
      layout: { width: 'fill', height: 'hug' },
    },
  },

  text: {
    type: 'text',
    label: 'Text',
    icon: 'T',
    category: 'content',
    description: 'A line or paragraph of copy.',
    whenToUse: 'Anything read rather than used. Write the real words, not lorem ipsum.',
    container: false,
    props: ['text', 'binding'],
    defaults: {
      type: 'text',
      text: 'Text',
      style: { text: 'body.md', color: 'text' },
      layout: { width: 'fill', height: 'hug' },
    },
  },

  image: {
    type: 'image',
    label: 'Image',
    icon: '🖼',
    category: 'content',
    description: 'A picture. Described, never stored.',
    whenToUse: 'A photo, an illustration, a logo. Say what it shows in `src`.',
    container: false,
    props: ['src', 'alt', 'binding'],
    defaults: {
      type: 'image',
      src: 'Photograph',
      layout: { width: 'fill', height: 200 },
      style: { background: 'muted', radius: 'md' },
    },
  },

  icon: {
    type: 'icon',
    label: 'Icon',
    icon: '★',
    category: 'content',
    description: 'A small glyph.',
    whenToUse: 'Beside a label, or alone as a compact button.',
    container: false,
    props: ['icon', 'action', 'navigatesTo'],
    defaults: {
      type: 'icon',
      icon: '★',
      layout: { width: 24, height: 24 },
    },
  },

  avatar: {
    type: 'avatar',
    label: 'Avatar',
    icon: '👤',
    category: 'content',
    description: 'A round picture of a person.',
    whenToUse: 'A user, an author, a member of a list.',
    container: false,
    props: ['src', 'binding'],
    defaults: {
      type: 'avatar',
      layout: { width: 40, height: 40 },
      style: { background: 'muted', radius: 'full' },
    },
  },

  badge: {
    type: 'badge',
    label: 'Badge',
    icon: '◉',
    category: 'content',
    description: 'A small pill of status.',
    whenToUse: 'A count, a state, a tag. Never something you can click.',
    container: false,
    props: ['text', 'variant', 'binding'],
    defaults: {
      type: 'badge',
      text: 'Status',
      style: { text: 'caption', background: 'muted', radius: 'full' },
      layout: {
        width: 'hug',
        height: 'hug',
        padding: { top: 4, right: 10, bottom: 4, left: 10 },
      },
    },
  },

  divider: {
    type: 'divider',
    label: 'Divider',
    icon: '—',
    category: 'content',
    description: 'A rule between sections.',
    whenToUse: 'Sparingly — a gap usually says it better.',
    container: false,
    props: NONE,
    defaults: {
      type: 'divider',
      layout: { width: 'fill', height: 1 },
      style: { background: 'border' },
    },
  },

  spacer: {
    type: 'spacer',
    label: 'Spacer',
    icon: '␣',
    category: 'content',
    description: 'Empty space that pushes its neighbours apart.',
    whenToUse: 'To shove something to the far end of a row. A gap handles the rest.',
    container: false,
    props: NONE,
    defaults: { type: 'spacer', layout: { grow: 1, width: 'hug', height: 'hug' } },
  },

  chart: {
    type: 'chart',
    label: 'Chart',
    icon: '📊',
    category: 'content',
    description: 'A graph of some figures.',
    whenToUse: 'A dashboard. Say which figures in `binding` and which shape in `variant`.',
    container: false,
    props: ['variant', 'binding', 'text'],
    defaults: {
      type: 'chart',
      variant: 'line',
      layout: { width: 'fill', height: 220 },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  map: {
    type: 'map',
    label: 'Map',
    icon: '🗺',
    category: 'content',
    description: 'A map.',
    whenToUse: 'Anywhere geography is the point.',
    container: false,
    props: ['binding', 'text'],
    defaults: {
      type: 'map',
      layout: { width: 'fill', height: 260 },
      style: { background: 'muted', radius: 'md' },
    },
  },

  video: {
    type: 'video',
    label: 'Video',
    icon: '▶',
    category: 'content',
    description: 'A video player.',
    whenToUse: 'Playable media. Describe the content in `src`.',
    container: false,
    props: ['src', 'alt', 'binding'],
    defaults: {
      type: 'video',
      layout: { width: 'fill', height: 220 },
      style: { background: 'muted', radius: 'md' },
    },
  },

  /* ---- controls ------------------------------------------------------ */

  button: {
    type: 'button',
    label: 'Button',
    icon: '⬭',
    category: 'control',
    description: 'Something you press to make something happen.',
    whenToUse:
      'An action. Name the endpoint or service it reaches in `action`, or the screen it opens ' +
      'in `navigatesTo` — a button with neither is a hole in the design.',
    container: false,
    props: ['text', 'variant', 'icon', 'action', 'navigatesTo', 'disabled'],
    defaults: {
      type: 'button',
      text: 'Continue',
      variant: 'primary',
      layout: {
        width: 'hug',
        height: 40,
        align: 'center',
        justify: 'center',
        padding: { top: 0, right: 20, bottom: 0, left: 20 },
      },
      style: { text: 'body.md', background: 'accent', color: 'on-accent', radius: 'md' },
    },
  },

  link: {
    type: 'link',
    label: 'Link',
    icon: '↗',
    category: 'control',
    description: 'Text you press to go somewhere.',
    whenToUse: 'Navigation inside a sentence. Anything that changes data is a button.',
    container: false,
    props: ['text', 'navigatesTo', 'action'],
    defaults: {
      type: 'link',
      text: 'Learn more',
      style: { text: 'body.md', color: 'accent' },
      layout: { width: 'hug', height: 'hug' },
    },
  },

  input: {
    type: 'input',
    label: 'Text field',
    icon: '▭',
    category: 'control',
    description: 'One line of typed input.',
    whenToUse: 'A name, an email, an amount. Bind it to the screen state it fills.',
    container: false,
    props: [...FIELD_PROPS, 'variant', 'icon'],
    defaults: {
      type: 'input',
      label: 'Label',
      placeholder: 'Type here',
      layout: {
        width: 'fill',
        height: 40,
        padding: { top: 0, right: 12, bottom: 0, left: 12 },
      },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  textarea: {
    type: 'textarea',
    label: 'Text area',
    icon: '▤',
    category: 'control',
    description: 'Several lines of typed input.',
    whenToUse: 'A message, a description, notes.',
    container: false,
    props: FIELD_PROPS,
    defaults: {
      type: 'textarea',
      label: 'Label',
      placeholder: 'Type here',
      layout: {
        width: 'fill',
        height: 96,
        padding: { top: 10, right: 12, bottom: 10, left: 12 },
      },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  select: {
    type: 'select',
    label: 'Dropdown',
    icon: '▾',
    category: 'control',
    description: 'One choice out of a list.',
    whenToUse: 'More than about five options. Fewer, and radios read better.',
    container: false,
    props: [...FIELD_PROPS, 'options'],
    defaults: {
      type: 'select',
      label: 'Label',
      placeholder: 'Choose one',
      options: [{ label: 'First' }, { label: 'Second' }],
      layout: {
        width: 'fill',
        height: 40,
        padding: { top: 0, right: 12, bottom: 0, left: 12 },
      },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    icon: '☑',
    category: 'control',
    description: 'An independent yes or no.',
    whenToUse: 'Agreeing to terms, or picking several things out of a list.',
    container: false,
    props: FIELD_PROPS,
    defaults: {
      type: 'checkbox',
      label: 'Option',
      layout: { direction: 'row', gap: 8, align: 'center', width: 'hug', height: 'hug' },
    },
  },

  radio: {
    type: 'radio',
    label: 'Radio group',
    icon: '◉',
    category: 'control',
    description: 'One choice out of a few, all visible.',
    whenToUse: 'Two to five options where seeing them all matters.',
    container: false,
    props: [...FIELD_PROPS, 'options'],
    defaults: {
      type: 'radio',
      label: 'Choose',
      options: [{ label: 'First', selected: true }, { label: 'Second' }],
      layout: { direction: 'column', gap: 8, width: 'fill', height: 'hug' },
    },
  },

  toggle: {
    type: 'toggle',
    label: 'Toggle',
    icon: '⏻',
    category: 'control',
    description: 'A switch that takes effect immediately.',
    whenToUse: 'A setting that applies as soon as it is flipped. If it needs saving, use a checkbox.',
    container: false,
    props: FIELD_PROPS,
    defaults: {
      type: 'toggle',
      label: 'Setting',
      layout: { direction: 'row', gap: 12, align: 'center', justify: 'between', width: 'fill', height: 'hug' },
    },
  },

  slider: {
    type: 'slider',
    label: 'Slider',
    icon: '⟺',
    category: 'control',
    description: 'A value along a range.',
    whenToUse: 'A rough amount where the exact number does not matter.',
    container: false,
    props: FIELD_PROPS,
    defaults: {
      type: 'slider',
      label: 'Amount',
      layout: { width: 'fill', height: 32 },
    },
  },

  search: {
    type: 'search',
    label: 'Search',
    icon: '🔍',
    category: 'control',
    description: 'A field that filters what is on screen.',
    whenToUse: 'Over a list or a table. Name what it searches in `action`.',
    container: false,
    props: [...FIELD_PROPS, 'action'],
    defaults: {
      type: 'search',
      placeholder: 'Search',
      icon: '🔍',
      layout: {
        width: 'fill',
        height: 40,
        padding: { top: 0, right: 12, bottom: 0, left: 12 },
      },
      style: { background: 'surface', border: 'border', borderWidth: 1, radius: 'full' },
    },
  },

  upload: {
    type: 'upload',
    label: 'Upload',
    icon: '⇧',
    category: 'control',
    description: 'A place to drop a file.',
    whenToUse: 'Anywhere a file arrives. Say what is accepted in the helper line.',
    container: false,
    props: [...FIELD_PROPS, 'action'],
    defaults: {
      type: 'upload',
      label: 'Upload',
      helper: 'PNG or JPG, up to 5 MB',
      layout: {
        width: 'fill',
        height: 120,
        align: 'center',
        justify: 'center',
      },
      style: { border: 'border', borderWidth: 1, radius: 'md' },
    },
  },

  /* ---- reuse --------------------------------------------------------- */

  component: {
    type: 'component',
    label: 'Component',
    icon: '❖',
    category: 'reuse',
    description: 'An instance of a `ui_component` block from the diagram.',
    whenToUse:
      'Anything drawn on more than one screen. Point it at the component block rather than ' +
      'copying the tree, so changing it once changes it everywhere.',
    container: false,
    props: ['componentId', 'text', 'binding'],
    defaults: {
      type: 'component',
      layout: { width: 'fill', height: 'hug' },
      style: { border: 'accent', borderWidth: 1, radius: 'md' },
    },
  },
};

export const ELEMENT_CATEGORIES: { id: ElementCategory; label: string }[] = [
  { id: 'structure', label: 'Layout' },
  { id: 'content', label: 'Content' },
  { id: 'control', label: 'Controls' },
  { id: 'reuse', label: 'Reuse' },
];

export function elementInfo(type: ElementType): ElementTypeInfo {
  return ELEMENT_CATALOG[type];
}

export function elementCatalogList(): ElementTypeInfo[] {
  return ELEMENT_TYPES.map((type) => ELEMENT_CATALOG[type]);
}

/** True when this type is allowed to hold children. */
export function isContainer(type: ElementType): boolean {
  return ELEMENT_CATALOG[type].container;
}

/** What to call an element with no name of its own. */
export function elementLabel(type: ElementType, name: string, text: string): string {
  return name.trim() || text.trim().slice(0, 40) || ELEMENT_CATALOG[type].label;
}
