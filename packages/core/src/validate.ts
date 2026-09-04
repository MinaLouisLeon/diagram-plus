import { BLOCK_CATALOG } from './catalog.js';
import { EDGE_TYPE_INFO } from './edges.js';
import type { Diagram } from './diagram.js';
import type { Block } from './blocks.js';

/**
 * Semantic validation, layered on top of zod.
 *
 * zod answers "is this file well-formed?". This answers "is this design
 * implementable?" — which is the question that matters before Claude writes
 * code from it. Errors block; warnings are advice.
 */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  blockId?: string;
  edgeId?: string;
  /** How to fix it, phrased so it can be acted on directly. */
  hint?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  issues: ValidationIssue[];
}

function issue(
  severity: IssueSeverity,
  code: string,
  message: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { severity, code, message, ...extra };
}

/** Blocks that carry no implementable payload, so "empty" is fine. */
const DECORATIVE: ReadonlySet<string> = new Set(['note', 'custom']);

function blockIsEmpty(block: Block): boolean {
  switch (block.type) {
    case 'data_model':
      return block.data.fields.length === 0;
    case 'api_endpoint':
      return block.data.path === '' || block.data.path === '/';
    case 'service':
      return block.data.functions.length === 0;
    case 'function':
      return block.data.steps.length === 0;
    case 'ui_screen':
      return block.data.route === '' && block.data.purpose === '';
    case 'job':
      return block.data.steps.length === 0;
    case 'decision':
      return block.data.condition === '';
    case 'config':
      return block.data.keys.length === 0;
    case 'event':
      return block.data.payload.length === 0;
    default:
      return false;
  }
}

export function validateDiagram(diagram: Diagram): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map(diagram.blocks.map((b) => [b.id, b]));
  const groupIds = new Set(diagram.groups.map((g) => g.id));

  /* ---- structural errors ------------------------------------------ */

  const seenBlockIds = new Set<string>();
  for (const block of diagram.blocks) {
    if (seenBlockIds.has(block.id)) {
      issues.push(
        issue('error', 'duplicate_block_id', `Two blocks share the id ${block.id}.`, {
          blockId: block.id,
        }),
      );
    }
    seenBlockIds.add(block.id);

    if (block.groupId && !groupIds.has(block.groupId)) {
      issues.push(
        issue('error', 'missing_group', `Block "${block.name}" points at group ${block.groupId}, which does not exist.`, {
          blockId: block.id,
          hint: 'Clear the group, or create the group it refers to.',
        }),
      );
    }
  }

  for (const edge of diagram.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) {
      issues.push(
        issue('error', 'dangling_edge_source', `Connection ${edge.id} starts at block ${edge.source}, which does not exist.`, {
          edgeId: edge.id,
          hint: 'Delete the connection or repoint it at a real block.',
        }),
      );
    }
    if (!target) {
      issues.push(
        issue('error', 'dangling_edge_target', `Connection ${edge.id} ends at block ${edge.target}, which does not exist.`, {
          edgeId: edge.id,
          hint: 'Delete the connection or repoint it at a real block.',
        }),
      );
    }
    if (edge.source === edge.target) {
      issues.push(
        issue('warning', 'self_loop', `${source ? `"${source.name}"` : edge.source} connects to itself.`, {
          edgeId: edge.id,
        }),
      );
    }
    if (!source || !target) continue;

    const info = EDGE_TYPE_INFO[edge.type];
    if (info.validSources && !info.validSources.includes(source.type)) {
      issues.push(
        issue(
          'warning',
          'edge_source_type',
          `A ${BLOCK_CATALOG[source.type].label.toLowerCase()} does not usually "${info.label}" anything.`,
          {
            edgeId: edge.id,
            blockId: source.id,
            hint: `"${info.label}" normally starts at: ${info.validSources.join(', ')}.`,
          },
        ),
      );
    }
    if (info.validTargets && !info.validTargets.includes(target.type)) {
      issues.push(
        issue(
          'warning',
          'edge_target_type',
          `"${info.label}" does not usually point at a ${BLOCK_CATALOG[target.type].label.toLowerCase()}.`,
          {
            edgeId: edge.id,
            blockId: target.id,
            hint: `"${info.label}" normally points at: ${info.validTargets.join(', ')}.`,
          },
        ),
      );
    }
    if (edge.type === 'conditional' && !edge.condition && !edge.label) {
      issues.push(
        issue('warning', 'conditional_without_condition', `Conditional connection from "${source.name}" has no condition.`, {
          edgeId: edge.id,
          hint: 'Say when this path is taken.',
        }),
      );
    }
  }

  /* ---- duplicate names -------------------------------------------- */

  const nameCounts = new Map<string, Block[]>();
  for (const block of diagram.blocks) {
    const key = `${block.type}::${block.name.toLowerCase()}`;
    const list = nameCounts.get(key) ?? [];
    list.push(block);
    nameCounts.set(key, list);
  }
  for (const [, blocks] of nameCounts) {
    if (blocks.length > 1 && blocks[0]) {
      issues.push(
        issue('warning', 'duplicate_name', `${blocks.length} ${BLOCK_CATALOG[blocks[0].type].label.toLowerCase()} blocks are called "${blocks[0].name}".`, {
          blockId: blocks[0].id,
          hint: 'Rename them so generated code does not collide.',
        }),
      );
    }
  }

  /* ---- completeness ------------------------------------------------ */

  const connected = new Set<string>();
  for (const edge of diagram.edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  for (const block of diagram.blocks) {
    if (DECORATIVE.has(block.type)) continue;

    if (blockIsEmpty(block)) {
      issues.push(
        issue('warning', 'block_incomplete', `"${block.name}" has no details filled in yet.`, {
          blockId: block.id,
          hint: `Fill in the ${BLOCK_CATALOG[block.type].label.toLowerCase()} details so it can be implemented.`,
        }),
      );
    }

    if (diagram.blocks.length > 1 && !connected.has(block.id)) {
      issues.push(
        issue('info', 'orphan_block', `"${block.name}" is not connected to anything.`, {
          blockId: block.id,
          hint: 'Connect it, or delete it if it is not part of the design.',
        }),
      );
    }
  }

  /* ---- relation targets -------------------------------------------- */

  const modelNames = new Set(
    diagram.blocks.filter((b) => b.type === 'data_model').map((b) => b.name.toLowerCase()),
  );
  for (const block of diagram.blocks) {
    if (block.type !== 'data_model') continue;
    for (const relation of block.data.relations) {
      if (relation.to && !modelNames.has(relation.to.toLowerCase())) {
        issues.push(
          issue('warning', 'unknown_relation_target', `"${block.name}" relates to "${relation.to}", which is not a data model in this diagram.`, {
            blockId: block.id,
            hint: 'Add the missing model, or correct the name.',
          }),
        );
      }
    }
  }

  /* ---- diagram level ------------------------------------------------ */

  if (diagram.blocks.length === 0) {
    issues.push(
      issue('warning', 'empty_diagram', 'This diagram has no blocks yet.', {
        hint: 'Add the screens, endpoints and models the project needs.',
      }),
    );
  }
  if (!diagram.projectGoal.trim()) {
    issues.push(
      issue('info', 'no_project_goal', 'No project goal is set.', {
        hint: 'A one-paragraph goal makes the generated implementation spec far more useful.',
      }),
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const info = issues.filter((i) => i.severity === 'info');

  return { valid: errors.length === 0, errors, warnings, info, issues };
}
