import type { Diagram } from './diagram.js';
import type { Block, BlockOf } from './blocks.js';
import type { Field } from './common.js';
import { BLOCK_CATALOG } from './catalog.js';
import { EDGE_TYPE_INFO } from './edges.js';
import { buildOrder, diagramStats } from './analysis.js';
import { renderDesignSystem, renderScreenOutline } from './design-render.js';
import type { DesignDocument, ScreenDesign } from './design.js';
import { validateDiagram } from './validate.js';
import { toMermaid } from './export.js';

/**
 * The implementation spec.
 *
 * This is the hand-off document: everything in the diagram, flattened into
 * ordered Markdown that an implementer can work straight through. It is what
 * `read_implementation_spec` returns, and it is deliberately verbose — the
 * whole point of drawing the diagram was to pin these details down.
 */

export interface SpecOptions {
  /** Include the Mermaid overview diagram. */
  includeDiagram?: boolean;
  /** Include the raw connection table. */
  includeConnections?: boolean;
  /** Include validation warnings as an "open questions" section. */
  includeIssues?: boolean;
  /**
   * The screen designs, when the project has any.
   *
   * Passed in rather than read off the diagram because designs live in their
   * own file: the generator stays a pure function of what it is handed, and a
   * caller that only wants the graph simply does not pass them.
   *
   * When present, each screen's section gains the layout it was designed with
   * — every element, its words, what it is bound to and what it does — so the
   * implementer builds the screen that was drawn rather than one of their own.
   */
  design?: DesignDocument | null;
}

class Doc {
  private lines: string[] = [];

  line(text = ''): this {
    this.lines.push(text);
    return this;
  }

  heading(level: number, text: string): this {
    if (this.lines.length) this.line();
    this.line(`${'#'.repeat(level)} ${text}`);
    this.line();
    return this;
  }

  bullet(text: string): this {
    this.line(`- ${text}`);
    return this;
  }

  table(headers: string[], rows: string[][]): this {
    if (rows.length === 0) return this;
    this.line(`| ${headers.join(' | ')} |`);
    this.line(`| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) this.line(`| ${row.join(' | ')} |`);
    this.line();
    return this;
  }

  code(text: string, lang = ''): this {
    this.line('```' + lang);
    this.line(text);
    this.line('```');
    this.line();
    return this;
  }

  toString(): string {
    return this.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
}

const cell = (value: unknown): string =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim() || '—';

function fieldRows(fields: Field[]): string[][] {
  return fields.map((f) => [
    `\`${f.name}\``,
    `\`${f.type || 'string'}\``,
    f.required ? 'yes' : 'no',
    cell(f.description),
    f.example ? `\`${f.example}\`` : '—',
  ]);
}

const FIELD_HEADERS = ['Field', 'Type', 'Required', 'Description', 'Example'];

function sectionFields(doc: Doc, label: string, fields: Field[]): void {
  if (!fields.length) return;
  doc.line(`**${label}**`).line();
  doc.table(FIELD_HEADERS, fieldRows(fields));
}

function steps(doc: Doc, label: string, list: string[]): void {
  if (!list.length) return;
  doc.line(`**${label}**`).line();
  list.forEach((step, i) => doc.line(`${i + 1}. ${step}`));
  doc.line();
}

function byType<T extends Block['type']>(diagram: Diagram, type: T): BlockOf<T>[] {
  return diagram.blocks.filter((b): b is BlockOf<T> => b.type === type);
}

function statusMark(block: Block): string {
  switch (block.implementation.status) {
    case 'done':
      return '[x]';
    case 'in_progress':
      return '[~]';
    case 'blocked':
      return '[!]';
    default:
      return '[ ]';
  }
}

function heading(block: Block): string {
  return `${BLOCK_CATALOG[block.type].icon} ${block.name}`;
}

function describe(doc: Doc, block: Block): void {
  if (block.summary) doc.line(`_${block.summary}_`).line();
  if (block.description) doc.line(block.description).line();
  if (block.tags.length) doc.line(`Tags: ${block.tags.map((t) => `\`${t}\``).join(', ')}`).line();
  if (block.implementation.files.length) {
    doc.line(`Implemented in: ${block.implementation.files.map((f) => `\`${f}\``).join(', ')}`).line();
  }
}

/* ------------------------------------------------------------------ *
 * Per-type detail
 * ------------------------------------------------------------------ */

/** Every artboard drawn for a block, the main variant first. */
function designsFor(design: DesignDocument | null | undefined, block: Block): ScreenDesign[] {
  if (!design) return [];
  return design.screens
    .filter((screen) => screen.blockId === block.id && !screen.orphaned)
    .sort((a, b) => (a.variant ? 1 : 0) - (b.variant ? 1 : 0) || a.order - b.order);
}

function specForBlock(
  doc: Doc,
  block: Block,
  diagram: Diagram,
  design?: DesignDocument | null,
): void {
  doc.heading(3, heading(block));
  describe(doc, block);

  switch (block.type) {
    case 'config': {
      doc.table(
        ['Key', 'Required', 'Secret', 'Description', 'Example'],
        block.data.keys.map((k) => [
          `\`${k.name}\``,
          k.required ? 'yes' : 'no',
          k.secret ? 'yes' : 'no',
          cell(k.description),
          k.example ? `\`${k.example}\`` : '—',
        ]),
      );
      break;
    }

    case 'data_model': {
      if (block.data.storage) doc.bullet(`Storage: ${block.data.storage}`);
      if (block.data.tableName) doc.bullet(`Table: \`${block.data.tableName}\``);
      doc.line();
      sectionFields(doc, 'Fields', block.data.fields);
      if (block.data.relations.length) {
        doc.line('**Relations**').line();
        doc.table(
          ['Kind', 'Related model', 'Description'],
          block.data.relations.map((r) => [r.kind, `\`${r.to}\``, cell(r.description)]),
        );
      }
      if (block.data.indexes.length) {
        doc.line('**Indexes**').line();
        block.data.indexes.forEach((i) => doc.bullet(`\`${i}\``));
        doc.line();
      }
      if (block.data.constraints.length) {
        doc.line('**Constraints**').line();
        block.data.constraints.forEach((c) => doc.bullet(c));
        doc.line();
      }
      break;
    }

    case 'datastore': {
      if (block.data.engine) doc.bullet(`Engine: ${block.data.engine}`);
      if (block.data.purpose) doc.bullet(`Purpose: ${block.data.purpose}`);
      if (block.data.entities.length) doc.bullet(`Holds: ${block.data.entities.join(', ')}`);
      if (block.data.notes) doc.bullet(`Notes: ${block.data.notes}`);
      doc.line();
      break;
    }

    case 'external_service': {
      if (block.data.provider) doc.bullet(`Provider: ${block.data.provider}`);
      doc.bullet(`Protocol: ${block.data.protocol}`);
      if (block.data.authMethod) doc.bullet(`Auth: ${block.data.authMethod}`);
      if (block.data.envKeys.length) {
        doc.bullet(`Environment keys: ${block.data.envKeys.map((k) => `\`${k}\``).join(', ')}`);
      }
      doc.line();
      if (block.data.operations.length) {
        doc.table(
          ['Operation', 'Description'],
          block.data.operations.map((o) => [`\`${o.name}\``, cell(o.description)]),
        );
      }
      break;
    }

    case 'event': {
      if (block.data.channel) doc.bullet(`Channel: \`${block.data.channel}\``);
      doc.bullet(`Delivery: ${block.data.deliveryGuarantee}`);
      if (block.data.producers.length) doc.bullet(`Produced by: ${block.data.producers.join(', ')}`);
      if (block.data.consumers.length) doc.bullet(`Consumed by: ${block.data.consumers.join(', ')}`);
      doc.line();
      sectionFields(doc, 'Payload', block.data.payload);
      break;
    }

    case 'service': {
      if (block.data.responsibility) doc.line(block.data.responsibility).line();
      if (block.data.dependencies.length) {
        doc.bullet(`Depends on: ${block.data.dependencies.join(', ')}`).line();
      }
      for (const fn of block.data.functions) {
        const args = fn.params.map((p) => `${p.name}: ${p.type || 'unknown'}`).join(', ');
        doc.line(`#### \`${fn.async ? 'async ' : ''}${fn.name}(${args})${fn.returns ? `: ${fn.returns}` : ''}\``).line();
        if (fn.description) doc.line(fn.description).line();
        sectionFields(doc, 'Parameters', fn.params);
        steps(doc, 'Steps', fn.steps);
        if (fn.throws.length) {
          doc.line('**Throws**').line();
          fn.throws.forEach((t) => doc.bullet(t));
          doc.line();
        }
      }
      break;
    }

    case 'function': {
      const args = block.data.params.map((p) => `${p.name}: ${p.type || 'unknown'}`).join(', ');
      const signature =
        block.data.signature ||
        `${block.data.async ? 'async ' : ''}${block.name}(${args})${block.data.returns ? `: ${block.data.returns}` : ''}`;
      doc.code(signature, block.data.language || 'text');
      sectionFields(doc, 'Parameters', block.data.params);
      steps(doc, 'Steps', block.data.steps);
      if (block.data.throws.length) {
        doc.line('**Throws**').line();
        block.data.throws.forEach((t) => doc.bullet(t));
        doc.line();
      }
      if (block.data.notes) doc.line(`**Notes** ${block.data.notes}`).line();
      break;
    }

    case 'job': {
      doc.bullet(`Trigger: ${block.data.trigger}`);
      if (block.data.schedule) doc.bullet(`Schedule: \`${block.data.schedule}\``);
      doc.bullet(`Idempotent: ${block.data.idempotent ? 'yes' : 'no'}`);
      if (block.data.retries) doc.bullet(`Retries: ${block.data.retries}`);
      doc.line();
      steps(doc, 'Steps', block.data.steps);
      if (block.data.notes) doc.line(block.data.notes).line();
      break;
    }

    case 'api_endpoint': {
      doc.code(`${block.data.method} ${block.data.path}`, 'http');
      doc.bullet(`Auth: ${block.data.auth}`);
      doc.line();
      if (block.data.summary) doc.line(block.data.summary).line();
      sectionFields(doc, 'Path parameters', block.data.pathParams);
      sectionFields(doc, 'Query parameters', block.data.queryParams);
      sectionFields(doc, 'Request body', block.data.requestBody);
      for (const response of block.data.responses) {
        doc.line(`**Response ${response.status}** ${response.description}`).line();
        if (response.body.length) doc.table(FIELD_HEADERS, fieldRows(response.body));
      }
      if (block.data.errors.length) {
        doc.line('**Errors**').line();
        doc.table(
          ['Status', 'Code', 'When'],
          block.data.errors.map((e) => [String(e.status), e.code ? `\`${e.code}\`` : '—', cell(e.when)]),
        );
      }
      if (block.data.notes) doc.line(block.data.notes).line();
      break;
    }

    case 'ui_component': {
      if (block.data.purpose) doc.line(block.data.purpose).line();
      sectionFields(doc, 'Props', block.data.props);
      if (block.data.emits.length) {
        doc.line('**Events**').line();
        doc.table(
          ['Event', 'Payload', 'When'],
          block.data.emits.map((e) => [`\`${e.name}\``, cell(e.payload), cell(e.description)]),
        );
      }
      sectionFields(doc, 'Internal state', block.data.state);
      if (block.data.variants.length) doc.bullet(`Variants: ${block.data.variants.join(', ')}`).line();
      break;
    }

    case 'ui_screen': {
      if (block.data.route) doc.bullet(`Route: \`${block.data.route}\``);
      if (block.data.layout) doc.bullet(`Layout: ${block.data.layout}`);
      if (block.data.permissions.length) doc.bullet(`Access: ${block.data.permissions.join(', ')}`);
      doc.line();
      if (block.data.purpose) doc.line(block.data.purpose).line();
      if (block.data.components.length) {
        doc.line('**Renders**').line();
        block.data.components.forEach((c) => doc.bullet(c));
        doc.line();
      }
      sectionFields(doc, 'State', block.data.state);
      if (block.data.actions.length) {
        doc.line('**Actions**').line();
        doc.table(
          ['Action', 'Calls', 'Description'],
          block.data.actions.map((a) => [a.name, a.calls ? `\`${a.calls}\`` : '—', cell(a.description)]),
        );
      }
      break;
    }

    case 'decision': {
      if (block.data.condition) doc.line(`**Condition** ${block.data.condition}`).line();
      if (block.data.branches.length) {
        doc.table(
          ['Branch', 'When', 'Then'],
          block.data.branches.map((b) => [b.label, cell(b.when), cell(b.description)]),
        );
      }
      break;
    }

    case 'loop': {
      if (block.data.over) doc.bullet(`Over: ${block.data.over}`);
      if (block.data.condition) doc.bullet(`While: ${block.data.condition}`);
      if (block.data.maxIterations) doc.bullet(`Max iterations: ${block.data.maxIterations}`);
      doc.line();
      steps(doc, 'Body', block.data.body);
      break;
    }

    case 'note': {
      if (block.data.text) doc.line(`> ${block.data.text.replace(/\n/g, '\n> ')}`).line();
      break;
    }

    case 'custom': {
      if (block.data.kindLabel) doc.bullet(`Kind: ${block.data.kindLabel}`).line();
      if (block.data.entries.length) {
        doc.table(
          ['Key', 'Value'],
          block.data.entries.map((e) => [`\`${e.key}\``, cell(e.value)]),
        );
      }
      break;
    }
  }

  const connections = diagram.edges.filter((e) => e.source === block.id);
  if (connections.length) {
    const byId = new Map(diagram.blocks.map((b) => [b.id, b]));
    doc.line('**Connects to**').line();
    for (const edge of connections) {
      const target = byId.get(edge.target);
      const label = EDGE_TYPE_INFO[edge.type].label;
      const suffix = edge.condition ? ` — when ${edge.condition}` : edge.label ? ` — ${edge.label}` : '';
      doc.bullet(`${label} **${target?.name ?? edge.target}**${suffix}`);
    }
    doc.line();
  }

  // The design goes last: the block says what the screen is for, this says
  // what it looks like, and reading them in that order is how it gets built.
  for (const screen of designsFor(design, block)) {
    doc.line();
    doc.line(renderScreenOutline(screen));
    doc.line();
  }
}

/* ------------------------------------------------------------------ *
 * Whole-diagram spec
 * ------------------------------------------------------------------ */

const SECTIONS: { type: Block['type']; title: string }[] = [
  { type: 'config', title: 'Configuration' },
  { type: 'data_model', title: 'Data models' },
  { type: 'datastore', title: 'Datastores' },
  { type: 'external_service', title: 'External services' },
  { type: 'event', title: 'Events' },
  { type: 'service', title: 'Services' },
  { type: 'function', title: 'Functions' },
  { type: 'job', title: 'Background jobs' },
  { type: 'api_endpoint', title: 'API endpoints' },
  { type: 'ui_component', title: 'UI components' },
  { type: 'ui_screen', title: 'Screens' },
  { type: 'decision', title: 'Decisions' },
  { type: 'loop', title: 'Loops' },
  { type: 'custom', title: 'Other' },
  { type: 'note', title: 'Notes' },
];

export function generateSpec(diagram: Diagram, options: SpecOptions = {}): string {
  const opts = { includeDiagram: true, includeConnections: true, includeIssues: true, ...options };
  const doc = new Doc();
  const stats = diagramStats(diagram);
  const order = buildOrder(diagram);

  doc.line(`# ${diagram.name} — implementation spec`).line();
  doc.line(
    `Generated from \`.diagrams/${diagram.slug}.diagram.json\` (revision ${diagram.revision}, status **${diagram.status}**).`,
  );
  doc.line();
  if (diagram.status === 'draft') {
    doc.line(
      '> **This diagram is still a draft.** The design may change. Confirm with the author before building from it.',
    ).line();
  }
  if (diagram.description) doc.line(diagram.description).line();

  if (diagram.projectGoal) {
    doc.heading(2, 'Goal');
    doc.line(diagram.projectGoal);
  }

  const stack = diagram.techStack;
  const stackEntries = [
    ['Language', stack.language],
    ['Frontend', stack.frontend],
    ['Backend', stack.backend],
    ['Database', stack.database],
  ].filter(([, v]) => v);
  if (stackEntries.length || stack.packages.length || stack.notes) {
    doc.heading(2, 'Tech stack');
    for (const [label, value] of stackEntries) doc.bullet(`**${label}:** ${value}`);
    if (stack.packages.length) doc.bullet(`**Packages:** ${stack.packages.join(', ')}`);
    doc.line();
    if (stack.notes) doc.line(stack.notes).line();
  }

  doc.heading(2, 'Overview');
  doc.bullet(`${stats.blocks} blocks, ${stats.edges} connections`);
  doc.bullet(stats.byType.map((t) => `${t.count} × ${t.label}`).join(', ') || 'no blocks yet');
  doc.line();
  if (opts.includeDiagram && diagram.blocks.length) {
    doc.code(toMermaid(diagram), 'mermaid');
  }

  // The tokens come before the screens that refer to them: an outline saying
  // `heading.lg` and `accent` is only an instruction if those are defined
  // somewhere the same reader has already passed.
  if (opts.design && opts.design.screens.length) {
    doc.heading(2, 'Design system');
    doc.line(
      'Every screen below is drawn against these tokens. Build them once — as CSS variables, a ' +
        'theme object, whatever the stack wants — and refer to them by name rather than pasting ' +
        'the values in.',
    ).line();
    doc.line(renderDesignSystem(opts.design.system));
    doc.line();
  }

  if (order.phases.length) {
    doc.heading(2, 'Build order');
    doc.line('Work through these in order — each phase only depends on the ones above it.').line();
    for (const phase of order.phases) {
      doc.line(`**${phase.index}. ${phase.label}**`).line();
      for (const block of phase.blocks) {
        doc.line(`- ${statusMark(block)} ${block.name} — ${BLOCK_CATALOG[block.type].label.toLowerCase()}`);
      }
      doc.line();
    }
    if (order.cycles.length) {
      doc.line('> Circular dependencies detected: ' + order.cycles.map((c) => c.join(' → ')).join('; ')).line();
    }
  }

  for (const section of SECTIONS) {
    const blocks = byType(diagram, section.type);
    if (!blocks.length) continue;

    doc.heading(2, section.title);

    if (section.type === 'api_endpoint') {
      doc.table(
        ['Method', 'Path', 'Auth', 'Purpose'],
        blocks.map((b) => {
          const data = (b as BlockOf<'api_endpoint'>).data;
          return [`\`${data.method}\``, `\`${data.path}\``, data.auth, cell(data.summary || b.summary)];
        }),
      );
    }
    if (section.type === 'ui_screen') {
      doc.table(
        ['Screen', 'Route', 'Purpose'],
        blocks.map((b) => {
          const data = (b as BlockOf<'ui_screen'>).data;
          return [b.name, data.route ? `\`${data.route}\`` : '—', cell(data.purpose || b.summary)];
        }),
      );
    }

    for (const block of blocks) specForBlock(doc, block, diagram, opts.design);
  }

  if (opts.includeConnections && diagram.edges.length) {
    const byId = new Map(diagram.blocks.map((b) => [b.id, b]));
    doc.heading(2, 'All connections');
    doc.table(
      ['From', 'Relationship', 'To', 'Detail'],
      diagram.edges.map((e) => [
        cell(byId.get(e.source)?.name ?? e.source),
        EDGE_TYPE_INFO[e.type].label,
        cell(byId.get(e.target)?.name ?? e.target),
        cell(e.condition || e.label || e.description),
      ]),
    );
  }

  if (opts.includeIssues) {
    const validation = validateDiagram(diagram);
    const open = [...validation.errors, ...validation.warnings];
    if (open.length) {
      doc.heading(2, 'Open questions and gaps');
      doc.line('The design has these loose ends. Resolve them, or ask before assuming.').line();
      for (const item of open) {
        doc.bullet(`**${item.severity}** — ${item.message}${item.hint ? ` _${item.hint}_` : ''}`);
      }
      doc.line();
    }
  }

  if (diagram.notes) {
    doc.heading(2, 'Additional notes');
    doc.line(diagram.notes);
  }

  doc.heading(2, 'Progress');
  doc.bullet(`${stats.implemented} of ${stats.blocks - (stats.byType.find((t) => t.type === 'note')?.count ?? 0)} blocks implemented (${stats.completion}%)`);
  doc.line();
  doc.line(
    'As you implement each block, record it with the `mark_block_implemented` tool so the diagram shows progress.',
  );

  return doc.toString();
}

/** A focused spec for a single block — used when implementing piece by piece. */
export function generateBlockSpec(
  diagram: Diagram,
  block: Block,
  options: { design?: DesignDocument | null } = {},
): string {
  const doc = new Doc();
  doc.line(`# ${block.name}`).line();
  doc.line(`${BLOCK_CATALOG[block.type].label} in **${diagram.name}**.`).line();
  specForBlock(doc, block, diagram, options.design);
  return doc.toString();
}
