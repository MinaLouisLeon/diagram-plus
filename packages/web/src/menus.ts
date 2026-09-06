import {
  BLOCK_CATALOG,
  EDGE_TYPES,
  EDGE_TYPE_INFO,
  type BatchOperation,
  type Block,
  type BlockType,
  type Diagram,
  type Edge,
  type ImplementationStatus,
} from '@diagram-plus/core/browser';
import type { Catalog } from './api';
import { separator, type MenuEntry, type MenuItem } from './context-menu';
import { store } from './store';
import { copyText } from './text-menu';

/**
 * The menus for the things a diagram is made of.
 *
 * A block has the same menu wherever it is right-clicked — on the canvas or in
 * the build list — so they are built here rather than in either component.
 */

const IMPL_STATUSES: ImplementationStatus[] = ['todo', 'in_progress', 'done', 'blocked'];

interface BlockMenuOptions {
  /** True on the canvas, where the delete key and "center on" mean something. */
  onCanvas?: boolean;
  onCenter?: () => void;
  /** Items for the top of the menu, under the heading. */
  lead?: MenuEntry[];
}

export function blockMenu(
  diagram: Diagram,
  ids: string[],
  options: BlockMenuOptions = {},
): MenuEntry[] {
  const blocks = ids
    .map((id) => diagram.blocks.find((block) => block.id === id))
    .filter((block): block is Block => Boolean(block));
  if (!blocks.length) return [];

  const many = blocks.length > 1;
  const first = blocks[0]!;

  const entries: MenuEntry[] = [
    {
      kind: 'heading',
      label: many ? `${blocks.length} blocks selected` : `${BLOCK_CATALOG[first.type].icon} ${first.name}`,
    },
    ...(options.lead ?? []),
    ...(options.lead?.length ? [separator] : []),
    { label: many ? 'Duplicate blocks' : 'Duplicate', onSelect: () => duplicateBlocks(blocks) },
    {
      label: many ? 'Delete blocks' : 'Delete',
      hint: options.onCanvas ? 'Del' : undefined,
      danger: true,
      onSelect: () =>
        store.apply(blocks.map((block): BatchOperation => ({ op: 'delete_block', block: block.id }))),
    },
    separator,
    statusSubmenu(blocks),
    separator,
  ];

  if (options.onCenter) {
    entries.push({ label: many ? 'Center on these' : 'Center on canvas', onSelect: options.onCenter });
  }
  entries.push({
    label: many ? 'Copy names' : 'Copy name',
    onSelect: () => void copyText(blocks.map((block) => block.name).join('\n')),
  });

  return entries;
}

function statusSubmenu(blocks: Block[]): MenuItem {
  const statuses = new Set(blocks.map((block) => block.implementation.status));
  const shared = statuses.size === 1 ? [...statuses][0] : null;

  return {
    label: blocks.length > 1 ? 'Mark all as' : 'Mark as',
    items: IMPL_STATUSES.map((status) => ({
      label: status.replace('_', ' '),
      checked: status === shared,
      onSelect: () =>
        store.apply(
          blocks.map(
            (block): BatchOperation => ({
              op: 'update_block',
              block: block.id,
              patch: { implementation: { status } },
            }),
          ),
        ),
    })),
  };
}

/** A copy sits just below and right of the original, and takes the selection. */
function duplicateBlocks(blocks: Block[]): void {
  const result = store.apply(
    blocks.map(
      (block): BatchOperation => ({
        op: 'add_block',
        block: {
          type: block.type,
          name: `${block.name} copy`,
          summary: block.summary,
          description: block.description,
          position: { x: block.position.x + 28, y: block.position.y + 28 },
          size: { ...block.size },
          groupId: block.groupId,
          tags: [...block.tags],
          color: block.color,
          data: structuredClone(block.data) as Record<string, unknown>,
        },
      }),
    ),
  );
  const created = result?.createdBlocks ?? [];
  if (created.length) store.select(created.map((block) => block.id));
}

export function edgeMenu(diagram: Diagram, edge: Edge): MenuEntry[] {
  const source = diagram.blocks.find((block) => block.id === edge.source);
  const target = diagram.blocks.find((block) => block.id === edge.target);

  return [
    {
      kind: 'heading',
      label: `${source?.name ?? 'source'} → ${target?.name ?? 'target'}`,
    },
    {
      label: 'Relationship',
      items: EDGE_TYPES.map((type) => ({
        label: EDGE_TYPE_INFO[type].label,
        checked: type === edge.type,
        onSelect: () => store.apply([{ op: 'update_edge', edge: edge.id, patch: { type } }]),
      })),
    },
    {
      label: 'Reverse direction',
      disabled: !source || !target,
      onSelect: () =>
        store.apply([
          {
            op: 'update_edge',
            edge: edge.id,
            patch: { source: edge.target, target: edge.source },
          },
        ]),
    },
    separator,
    {
      label: 'Delete connection',
      hint: 'Del',
      danger: true,
      onSelect: () => store.apply([{ op: 'delete_edge', edge: edge.id }]),
    },
  ];
}

/**
 * The block palette as a menu, grouped the way the sidebar groups it. Falls
 * back to the built-in catalog if the server's copy has not arrived yet.
 */
export function addBlockSubmenu(
  catalog: Catalog | null,
  add: (type: BlockType) => void,
): MenuEntry[] {
  if (!catalog) {
    return (Object.keys(BLOCK_CATALOG) as BlockType[]).map((type) => ({
      label: BLOCK_CATALOG[type].label,
      icon: BLOCK_CATALOG[type].icon,
      onSelect: () => add(type),
    }));
  }

  const entries: MenuEntry[] = [];
  for (const category of catalog.categories) {
    const types = catalog.blockTypes.filter((info) => info.category === category.id);
    if (!types.length) continue;
    if (entries.length) entries.push(separator);
    entries.push({ kind: 'heading', label: category.label });
    for (const info of types) {
      entries.push({ label: info.label, icon: info.icon, onSelect: () => add(info.type) });
    }
  }
  return entries;
}
