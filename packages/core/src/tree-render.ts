import type { ProjectTree, TreeNode } from './tree.js';

/**
 * Ways to write a `ProjectTree` down.
 *
 * All three are for someone who is not going to open the editor: plain text to
 * paste into an email, Markdown to hand over as a document, and a small Mermaid
 * flowchart for when a picture is still wanted — but a picture of the tree, not
 * of the whole graph.
 */

export interface RenderOptions {
  /** Show the folded-away blocks each step passed through. */
  showVia?: boolean;
  /** Include the footer about filtered-out blocks and depth cuts. */
  showFooter?: boolean;
}

/** The one line that stands for a node, whatever the format. */
export function nodeLabel(node: TreeNode, options: RenderOptions = {}): string {
  let label = node.label;
  if (node.kind === 'question' && !label.trim().endsWith('?')) label = `${label}?`;
  if (node.kind === 'shows') label = `Shows ${label}`;
  if (node.kind === 'repeat') label = `${label} (already covered above)`;

  if (node.condition) {
    const condition = node.condition.trim();
    const lead = /^(if|when|unless|otherwise|else)\b/i.test(condition)
      ? condition
      : `If ${condition}`;
    label = `${lead} → ${label}`;
  }
  if (options.showVia && node.via.length) label = `${label} (via ${node.via.join(' → ')})`;
  return label;
}

function footer(tree: ProjectTree): string[] {
  const notes: string[] = [];
  if (tree.omitted.length) {
    notes.push(
      `${tree.omitted.length} block${tree.omitted.length === 1 ? '' : 's'} left out by the filter: ` +
        tree.omitted
          .slice(0, 8)
          .map((o) => o.name)
          .join(', ') +
        (tree.omitted.length > 8 ? ', …' : ''),
    );
  }
  if (tree.truncated) {
    notes.push('Some branches were cut short — raise the depth limit to see the rest.');
  }
  return notes;
}

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

export function treeToText(tree: ProjectTree, options: RenderOptions = {}): string {
  const { showFooter = true } = options;
  const lines: string[] = [tree.name];
  if (tree.description) lines.push(tree.description);
  lines.push('');

  const render = (nodes: TreeNode[], prefix: string): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const detail = node.detail ? `  —  ${node.detail}` : '';
      lines.push(`${prefix}${last ? '└─ ' : '├─ '}${nodeLabel(node, options)}${detail}`);
      render(node.children, `${prefix}${last ? '   ' : '│  '}`);
    });
  };

  tree.roots.forEach((root, index) => {
    if (index) lines.push('');
    const detail = root.detail ? `  —  ${root.detail}` : '';
    lines.push(`${nodeLabel(root, options)}${detail}`);
    render(root.children, '');
  });

  if (!tree.roots.length) lines.push('(nothing to show — the filter left no blocks)');

  const notes = showFooter ? footer(tree) : [];
  if (notes.length) {
    lines.push('');
    for (const note of notes) lines.push(`Note: ${note}`);
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

export function treeToMarkdown(tree: ProjectTree, options: RenderOptions = {}): string {
  const { showFooter = true } = options;
  const lines: string[] = [`# ${tree.name}`, ''];
  if (tree.description) lines.push(tree.description, '');
  lines.push(
    tree.audience === 'client'
      ? 'What the application does, in the order someone would meet it.'
      : 'Every block in the diagram, arranged as a tree.',
    '',
  );

  const bullets = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      const detail = node.detail ? ` — ${node.detail}` : '';
      lines.push(`${indent}- **${nodeLabel(node, options)}**${detail}`);
      bullets(node.children, depth + 1);
    }
  };

  const heading = (node: TreeNode, level: number): void => {
    lines.push('', `${'#'.repeat(level)} ${nodeLabel(node, options)}`, '');
    if (node.detail) lines.push(node.detail, '');
  };

  for (const root of tree.roots) {
    heading(root, 2);
    if (root.kind === 'section') {
      for (const child of root.children) {
        heading(child, 3);
        bullets(child.children, 0);
      }
    } else {
      bullets(root.children, 0);
    }
  }

  if (!tree.roots.length) lines.push('_Nothing to show — the filter left no blocks._');

  const notes = showFooter ? footer(tree) : [];
  if (notes.length) {
    lines.push('', '---', '');
    for (const note of notes) lines.push(`- ${note}`);
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/* ------------------------------------------------------------------ *
 * Mermaid
 * ------------------------------------------------------------------ */

function escape(text: string): string {
  return text.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

function shaped(node: TreeNode, label: string): string {
  switch (node.kind) {
    case 'question':
      return `{"${label}"}`;
    case 'data':
      return `[("${label}")]`;
    case 'integration':
      return `[/"${label}"/]`;
    case 'action':
    case 'automation':
      return `("${label}")`;
    default:
      return `["${label}"]`;
  }
}

/**
 * A flowchart of the tree — one node per step, the condition on the arrow. It
 * is a fraction of the size of `toMermaid(diagram)`, which is the point.
 */
export function treeToMermaid(tree: ProjectTree): string {
  const lines = ['flowchart TD'];

  const emit = (node: TreeNode, parentId: string | null, indent: string): void => {
    const label = escape(
      node.kind === 'question' && !node.label.trim().endsWith('?')
        ? `${node.label}?`
        : node.label,
    );
    lines.push(`${indent}${node.id}${shaped(node, label)}`);
    if (parentId) {
      const condition = escape(node.condition);
      lines.push(
        condition
          ? `${indent}${parentId} -- "${condition}" --> ${node.id}`
          : `${indent}${parentId} --> ${node.id}`,
      );
    }
    for (const child of node.children) emit(child, node.id, indent);
  };

  for (const root of tree.roots) {
    if (root.kind === 'section') {
      lines.push(`  subgraph ${root.id}_g["${escape(root.label)}"]`);
      for (const child of root.children) emit(child, null, '    ');
      lines.push('  end');
    } else {
      emit(root, null, '  ');
    }
  }

  if (tree.roots.length === 0) lines.push('  empty["Nothing to show"]');
  return lines.join('\n');
}
