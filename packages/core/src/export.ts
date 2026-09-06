import type { Diagram } from './diagram.js';
import type { Block } from './blocks.js';
import { BLOCK_CATALOG } from './catalog.js';
import { EDGE_TYPE_INFO } from './edges.js';
import { buildProjectTree, type TreeOptions } from './tree.js';
import { treeToMarkdown, treeToText } from './tree-render.js';

/**
 * Exports. Mermaid is the useful one — it renders in GitHub, in Claude's
 * replies and in the generated spec, so a diagram can be read without opening
 * the editor.
 */

function mermaidId(block: Block): string {
  return block.id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, ' ').trim();
}

/** Shape brackets per block type, so the diagram reads at a glance. */
function shape(block: Block, label: string): string {
  switch (block.type) {
    case 'decision':
      return `{"${label}"}`;
    case 'data_model':
    case 'datastore':
      return `[("${label}")]`;
    case 'external_service':
      return `[/"${label}"/]`;
    case 'event':
      return `>"${label}"]`;
    case 'note':
      return `["${label}"]`;
    case 'ui_screen':
    case 'ui_component':
      return `["${label}"]`;
    case 'api_endpoint':
    case 'service':
    case 'function':
    case 'job':
      return `("${label}")`;
    default:
      return `["${label}"]`;
  }
}

export interface MermaidOptions {
  direction?: 'LR' | 'TB';
  /** Draw group boxes as subgraphs. */
  showGroups?: boolean;
  /** Add the block type under each name. */
  showTypes?: boolean;
}

export function toMermaid(diagram: Diagram, options: MermaidOptions = {}): string {
  const { direction = 'LR', showGroups = true, showTypes = true } = options;
  const lines: string[] = [`flowchart ${direction}`];

  const label = (block: Block): string => {
    const name = escapeLabel(block.name);
    if (!showTypes) return name;
    return `${name}<br/><small>${BLOCK_CATALOG[block.type].label}</small>`;
  };

  const rendered = new Set<string>();
  const emit = (block: Block, indent: string): void => {
    lines.push(`${indent}${mermaidId(block)}${shape(block, label(block))}`);
    rendered.add(block.id);
  };

  if (showGroups && diagram.groups.length) {
    for (const group of diagram.groups) {
      const members = diagram.blocks.filter((b) => b.groupId === group.id);
      if (!members.length) continue;
      lines.push(`  subgraph ${group.id.replace(/[^a-zA-Z0-9_]/g, '_')}["${escapeLabel(group.name)}"]`);
      for (const block of members) emit(block, '    ');
      lines.push('  end');
    }
  }
  for (const block of diagram.blocks) {
    if (!rendered.has(block.id)) emit(block, '  ');
  }

  const ids = new Set(diagram.blocks.map((b) => b.id));
  for (const edge of diagram.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const info = EDGE_TYPE_INFO[edge.type];
    const text = escapeLabel(edge.condition || edge.label || info.label);
    const connector = info.style === 'dotted' ? `-. "${text}" .->` : `-- "${text}" -->`;
    lines.push(
      `  ${mermaidId({ id: edge.source } as Block)} ${connector} ${mermaidId({ id: edge.target } as Block)}`,
    );
  }

  // Colour classes, one per block type actually present.
  const usedTypes = [...new Set(diagram.blocks.map((b) => b.type))];
  for (const type of usedTypes) {
    const info = BLOCK_CATALOG[type];
    lines.push(`  classDef ${type} fill:${info.color}22,stroke:${info.color},color:#111,stroke-width:1px;`);
    const members = diagram.blocks.filter((b) => b.type === type).map((b) => mermaidId(b));
    if (members.length) lines.push(`  class ${members.join(',')} ${type};`);
  }

  return lines.join('\n');
}

export const EXPORT_FORMATS = ['mermaid', 'markdown', 'json', 'tree', 'tree-markdown'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** The extension each format wants when it is written to a file. */
export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
  mermaid: 'mmd',
  markdown: 'md',
  json: 'json',
  tree: 'txt',
  'tree-markdown': 'md',
};

export function exportDiagram(
  diagram: Diagram,
  format: ExportFormat,
  treeOptions: TreeOptions = {},
): string {
  switch (format) {
    case 'mermaid':
      return toMermaid(diagram);
    case 'json':
      return `${JSON.stringify(diagram, null, 2)}\n`;
    case 'markdown':
      return toMermaidDocument(diagram);
    case 'tree':
      return treeToText(buildProjectTree(diagram, treeOptions));
    case 'tree-markdown':
      return treeToMarkdown(buildProjectTree(diagram, treeOptions));
  }
}

/** A small human-readable summary with the Mermaid picture at the top. */
export function toMermaidDocument(diagram: Diagram): string {
  const lines = [`# ${diagram.name}`, ''];
  if (diagram.description) lines.push(diagram.description, '');
  lines.push('```mermaid', toMermaid(diagram), '```', '');
  return lines.join('\n');
}
