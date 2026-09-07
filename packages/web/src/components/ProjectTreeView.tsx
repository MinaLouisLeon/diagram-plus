import { useMemo, useState } from 'react';
import {
  buildProjectTree,
  nodeLabel,
  treeToText,
  type Diagram,
  type ProjectTree,
  type TreeNode,
  type TreeNodeKind,
  type TreeOptions,
} from '@diagram-plus/core/browser';
import { separator, showContextMenu } from '../context-menu';
import { store } from '../store';
import { copyText } from '../text-menu';

/**
 * The client view.
 *
 * The canvas is the truth and the spec is the contract, but neither is what
 * you put on a screen while a client watches. This is: one line per thing the
 * application does, nested the way someone would meet it, with the conditions
 * spelled out and the plumbing gone.
 *
 * Every row still knows which block it came from, so a question in the meeting
 * — "what is that one?" — is one click from the block on the canvas.
 */

/** A word for each kind, so a reader can tell a screen from a branch. */
const KIND_LABEL: Record<TreeNodeKind, string> = {
  section: 'part',
  screen: 'screen',
  shows: 'shows',
  action: 'does',
  question: 'decides',
  branch: 'outcome',
  automation: 'automatic',
  integration: 'outside service',
  data: 'information',
  note: 'note',
  repeat: 'seen above',
};

export function useProjectTree(diagram: Diagram | null, options: TreeOptions): ProjectTree | null {
  return useMemo(
    () => (diagram ? buildProjectTree(diagram, options) : null),
    [diagram, options],
  );
}

interface ProjectTreeViewProps {
  tree: ProjectTree;
  /** Bigger type and more air — for the presentation overlay. */
  large?: boolean;
  /** Show the folded-away blocks each step passed through. */
  showVia?: boolean;
}

export function ProjectTreeView({ tree, large = false, showVia = false }: ProjectTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (id: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!tree.roots.length) {
    return (
      <p className="hint">
        Nothing to show. Either the diagram is empty, or the filters have ruled everything out.
      </p>
    );
  }

  return (
    <div className={`tree${large ? ' large' : ''}`}>
      {tree.roots.map((root) => (
        <Row
          key={root.id}
          node={root}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          showVia={showVia}
        />
      ))}
      {tree.omitted.length || tree.truncated ? (
        <p className="hint tree-footnote">
          {tree.omitted.length
            ? `${tree.omitted.length} block${tree.omitted.length === 1 ? '' : 's'} left out by the filters: ${tree.omitted
                .slice(0, 6)
                .map((o) => o.name)
                .join(', ')}${tree.omitted.length > 6 ? ', …' : ''}. `
            : ''}
          {tree.truncated ? 'Some branches were cut short — raise the depth to see the rest.' : ''}
        </p>
      ) : null}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  showVia: boolean;
}

function Row({ node, depth, collapsed, onToggle, showVia }: RowProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const label = nodeLabel(node, { showVia });

  return (
    <div className="tree-branch">
      <div
        className={`tree-row ${node.kind}`}
        style={{ paddingLeft: 6 + depth * 20 }}
        onClick={() => {
          if (hasChildren) onToggle(node.id);
          if (node.blockId) store.select([node.blockId]);
        }}
        onContextMenu={(event) =>
          showContextMenu(event, [
            {
              label: 'Show on canvas',
              disabled: !node.blockId,
              onSelect: () => node.blockId && store.select([node.blockId]),
            },
            {
              label: isCollapsed ? 'Expand' : 'Collapse',
              disabled: !hasChildren,
              onSelect: () => onToggle(node.id),
            },
            separator,
            { label: 'Copy this line', onSelect: () => void copyText(label) },
          ])
        }
      >
        <span className={`tree-twist${hasChildren ? '' : ' leaf'}`} aria-hidden="true">
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </span>
        <span className="tree-text">
          <span className="tree-label">{label}</span>
          {node.detail ? <em>{node.detail}</em> : null}
        </span>
        <span className="tree-kind">{KIND_LABEL[node.kind]}</span>
      </div>
      {hasChildren && !isCollapsed
        ? node.children.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              showVia={showVia}
            />
          ))
        : null}
    </div>
  );
}

/** Copy and download buttons, shared by the panel and the overlay. */
export function TreeActions({ tree }: { tree: ProjectTree }) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <button
        className="btn small"
        title="Copy the tree as plain text"
        onClick={() => {
          void copyText(treeToText(tree)).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        className="btn small"
        title="Save it as a Markdown document to send on"
        onClick={() => void store.exportTree('tree-markdown')}
      >
        Save as Markdown
      </button>
    </>
  );
}
