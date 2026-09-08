/**
 * The palette.
 *
 * A screen is markup now, so what the palette offers is markup: a snippet per
 * thing somebody might want to place, written against the shared stylesheet so
 * a dragged-in button looks like the buttons Claude wrote.
 *
 * This replaces the thirty-six-entry element catalog the typed tree needed. It
 * is shorter on purpose — the old list had to enumerate everything the format
 * could express, whereas this only has to cover what a person reaches for
 * while talking over a design. Anything else they can ask Claude for, or type.
 */

export interface Snippet {
  id: string;
  label: string;
  icon: string;
  category: 'Layout' | 'Content' | 'Controls';
  html: string;
}

export const SNIPPETS: Snippet[] = [
  /* ---- layout ---- */
  { id: 'section', label: 'Section', icon: '▤', category: 'Layout', html: '<section class="col"></section>' },
  { id: 'row', label: 'Row', icon: '▭', category: 'Layout', html: '<div class="row"></div>' },
  { id: 'column', label: 'Column', icon: '▯', category: 'Layout', html: '<div class="col"></div>' },
  { id: 'card', label: 'Card', icon: '▢', category: 'Layout', html: '<article class="card col"><strong>Card title</strong><p class="muted">Supporting line.</p></article>' },
  { id: 'grid', label: 'Grid', icon: '▦', category: 'Layout', html: '<div class="grid"></div>' },
  { id: 'topbar', label: 'Top bar', icon: '▬', category: 'Layout', html: '<header class="topbar"><h1 class="text-heading-lg grow">Title</h1></header>' },
  { id: 'sidebar', label: 'Sidebar', icon: '▏', category: 'Layout', html: '<aside class="sidebar"><nav class="col"><a href="#" aria-current="page">Overview</a><a href="#">Settings</a></nav></aside>' },
  { id: 'form', label: 'Form', icon: '▣', category: 'Layout', html: '<form class="col"></form>' },
  { id: 'dialog', label: 'Dialog', icon: '⬜', category: 'Layout', html: '<dialog open class="card col"><strong>Are you sure?</strong><p class="muted">This cannot be undone.</p></dialog>' },

  /* ---- content ---- */
  { id: 'heading', label: 'Heading', icon: 'H', category: 'Content', html: '<h2 class="text-heading-md">Heading</h2>' },
  { id: 'text', label: 'Text', icon: 'T', category: 'Content', html: '<p>Some words that say what this is.</p>' },
  { id: 'muted', label: 'Quiet text', icon: '¶', category: 'Content', html: '<p class="muted">Secondary detail.</p>' },
  { id: 'image', label: 'Image', icon: '▣', category: 'Content', html: '<img alt="Describe what this shows">' },
  { id: 'avatar', label: 'Avatar', icon: '☻', category: 'Content', html: '<span class="avatar"></span>' },
  { id: 'badge', label: 'Badge', icon: '◍', category: 'Content', html: '<span class="badge">Active</span>' },
  { id: 'divider', label: 'Divider', icon: '—', category: 'Content', html: '<hr>' },
  {
    id: 'table',
    label: 'Table',
    icon: '▤',
    category: 'Content',
    html:
      '<table data-repeat="Record" data-repeat-count="4">' +
      '<thead><tr><th>Name</th><th>Status</th><th>Updated</th></tr></thead>' +
      '<tbody><tr><td>Aisha Rahman</td><td><span class="badge success">Active</span></td><td>2 weeks ago</td></tr></tbody>' +
      '</table>',
  },

  /* ---- controls ---- */
  { id: 'button', label: 'Button', icon: '⬭', category: 'Controls', html: '<button class="btn primary">Continue</button>' },
  { id: 'button-quiet', label: 'Quiet button', icon: '⬬', category: 'Controls', html: '<button class="btn">Cancel</button>' },
  { id: 'link', label: 'Link', icon: '↗', category: 'Controls', html: '<a href="#">Read more</a>' },
  { id: 'field', label: 'Text field', icon: '▭', category: 'Controls', html: '<label>Label<input placeholder="Placeholder"></label>' },
  { id: 'textarea', label: 'Text area', icon: '▤', category: 'Controls', html: '<label>Notes<textarea rows="3"></textarea></label>' },
  { id: 'select', label: 'Dropdown', icon: '▾', category: 'Controls', html: '<label>Choose<select><option>First</option><option>Second</option></select></label>' },
  { id: 'checkbox', label: 'Checkbox', icon: '☑', category: 'Controls', html: '<label class="row"><input type="checkbox"> Remember me</label>' },
  { id: 'search', label: 'Search', icon: '⌕', category: 'Controls', html: '<label>Search<input type="search" placeholder="Search"></label>' },
];

export const SNIPPET_CATEGORIES = ['Layout', 'Content', 'Controls'] as const;

export function snippetById(id: string): Snippet | undefined {
  return SNIPPETS.find((s) => s.id === id);
}
