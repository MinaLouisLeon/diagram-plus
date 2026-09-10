import { DEFAULT_DESIGN_SYSTEM, type DesignSystem, tokenSlug } from '@diagram-plus/core';

/**
 * What a model needs to know to draw a screen here.
 *
 * Baked into the design tool descriptions so a screen can be written without a
 * round-trip to `describe_design_schema` first — the same bargain `hints.ts`
 * makes for block payloads.
 *
 * A screen is HTML now, so most of what used to live here is gone: there is no
 * closed list of thirty-six element types to explain, because the list is
 * "HTML". What is left is the part HTML does not say on its own — which
 * attributes carry the wiring, which CSS variables exist, and the handful of
 * habits that separate a design somebody can show a client from a page of
 * unstyled tags.
 */

/** The house rules. Short, because they are repeated on several tools. */
export const DESIGN_RULES = [
  'Write real HTML with semantic tags — header, nav, form, label, table, button, dialog. The ' +
    'browser lays it out, so nothing needs positioning and nothing can overlap.',
  'Style with the shared stylesheet’s classes and the CSS variables — var(--color-accent), ' +
    'var(--radius-md), var(--space). Never a raw hex value, or the tokens panel stops working.',
  'Write the real words, and real-looking data. The user shows these to a client to win the ' +
    'work: "Aisha Rahman · 14 Mar 1988" sells it, "Lorem ipsum" and "Row 1" do not.',
  'Every button and link either calls something (data-action="POST /api/…") or goes somewhere ' +
    '(data-navigates-to="Screen name"). One with neither is a hole.',
  'Every field says where its value lives: data-binding="state.email" or "Order.total".',
  'Draw one row and set data-repeat="Patient" data-repeat-count="6" on what holds it. Never ' +
    'paste the row out six times.',
  'No <script>, no inline event handlers, no remote images — they are stripped on the way in. ' +
    'For imagery use inline <svg> or a CSS gradient, and describe photographs in alt text.',
  'A look true of every button belongs in the stylesheet; a one-off — this heading bigger, this ' +
    'card grey — goes on the element with set_style, still written against the tokens. That is ' +
    'what the properties panel writes, so an element carrying a style attribute is one the user ' +
    'styled by hand: leave it as it is unless you were asked to change it.',
] .map((rule, index) => `${index + 1}. ${rule}`).join('\n');

/** The attributes that carry the contract, since HTML has no opinion on them. */
export const DATA_ATTRIBUTES: Record<string, string> = {
  'data-binding': 'Where the value comes from: state.email, Order.total, props.label.',
  'data-action': 'What using it does. Name the endpoint or service block it reaches.',
  'data-navigates-to': 'The ui_screen it opens, by name or block id.',
  'data-repeat': 'The data model this is drawn once per. Put it on the container.',
  'data-repeat-count': 'How many to show in the mock-up. Defaults to 3.',
  'data-component': 'For an instance of a ui_component block: that block’s id.',
  'data-visible-when': 'Only drawn when this holds, e.g. "the basket is empty".',
  'data-src': 'What an image shows, when it is a description rather than a file.',
  'data-note': 'Anything the implementer needs that the markup cannot say.',
  'data-el': 'The editor’s handle on an element. Minted for you — never write one.',
};

/** Every CSS variable and class a screen can refer to, from the live tokens. */
export function tokenReference(system: DesignSystem = DEFAULT_DESIGN_SYSTEM): string {
  const lines: string[] = [];
  lines.push(
    'Colours: ' + system.colors.map((c) => `var(--color-${tokenSlug(c.name)})`).join(', '),
  );
  lines.push(
    'Readable-on colours: ' +
      system.colors.filter((c) => c.on).map((c) => `var(--on-${tokenSlug(c.name)})`).join(', '),
  );
  lines.push('Type scale: ' + system.typography.map((t) => `.text-${tokenSlug(t.name)}`).join(', '));
  lines.push('Radii: ' + system.radii.map((r) => `var(--radius-${tokenSlug(r.name)})`).join(', '));
  lines.push('Shadows: ' + system.shadows.map((s) => `var(--shadow-${tokenSlug(s.name)})`).join(', '));
  lines.push('Spacing: var(--space) — multiply it, e.g. calc(var(--space) * 3).');
  return lines.join('\n');
}

/** Classes the default stylesheet already provides, so screens stay consistent. */
export const STYLESHEET_CLASSES = [
  '.screen — the outermost element of a page: a padded column.',
  '.row / .col — a flex row or column with a gap. .grow takes the leftover space.',
  '.card — a bordered, padded surface. .grid — cards that wrap into columns.',
  '.btn with .primary / .danger / .ghost — buttons. A bare <button> is the quiet one.',
  '.badge with .success / .warning — a small pill of status.',
  '.avatar — a round placeholder for a person. .muted — secondary text.',
  'header.topbar — the bar across the top. aside.sidebar — a fixed column down one side.',
].join('\n');

/**
 * A worked example, which is worth more than any amount of prose.
 *
 * Chosen to show the things that are easy to get wrong: the wiring on
 * `data-*`, one repeated row rather than six, tokens rather than hex, and copy
 * that reads like a real product rather than a placeholder.
 */
export const DESIGN_EXAMPLE = `<main class="screen">
  <header class="topbar">
    <h1 class="text-heading-lg grow">Patients</h1>
    <button class="btn primary" data-action="POST /api/patients">Add patient</button>
  </header>

  <label>Search
    <input type="search" placeholder="Name or NHS number" data-binding="state.search">
  </label>

  <table data-repeat="Patient" data-repeat-count="6">
    <thead>
      <tr><th>Name</th><th>Date of birth</th><th>Last seen</th><th></th></tr>
    </thead>
    <tbody>
      <tr data-navigates-to="Patient detail">
        <td>Aisha Rahman</td>
        <td>14 March 1988</td>
        <td>2 weeks ago</td>
        <td><span class="badge success">Active</span></td>
      </tr>
    </tbody>
  </table>
</main>`;

/** The whole vocabulary as JSON, for `describe_design_schema`. */
export function designVocabularyJson(system?: DesignSystem) {
  return {
    format: 'A screen is one HTML fragment plus optional CSS of its own.',
    dataAttributes: DATA_ATTRIBUTES,
    tokens: tokenReference(system).split('\n'),
    stylesheetClasses: STYLESHEET_CLASSES.split('\n'),
    stripped: [
      '<script>, <style>, <iframe>, <object>, <embed>, <link>, <meta>',
      'every on* event handler attribute',
      'javascript: URLs',
      'remote images — the URL is kept on data-src and the src dropped',
    ],
  };
}
