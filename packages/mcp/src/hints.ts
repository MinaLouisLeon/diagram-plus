import {
  BLOCK_CATALOG,
  BLOCK_TYPES,
  EDGE_TYPE_INFO,
  EDGE_TYPES,
  type BlockType,
  type FieldDescriptor,
} from '@diagram-plus/core';

/**
 * Compact, human-readable descriptions of the block payloads.
 *
 * These are baked into the tool descriptions so the model knows what to put in
 * `data` without a round-trip to `describe_block_schema` first.
 */

function fieldHint(field: FieldDescriptor): string {
  switch (field.kind) {
    case 'stringList':
      return `${field.key}: string[]`;
    case 'recordList': {
      const inner = (field.fields ?? []).map((f) => f.key).join(', ');
      return `${field.key}: [{ ${inner} }]`;
    }
    case 'boolean':
      return `${field.key}: boolean`;
    case 'number':
      return `${field.key}: number`;
    case 'select':
      return `${field.key}: ${(field.options ?? []).join('|')}`;
    default:
      return `${field.key}: string`;
  }
}

export function blockDataHint(type: BlockType): string {
  return BLOCK_CATALOG[type].fields.map(fieldHint).join(', ');
}

export function blockTypeLine(type: BlockType): string {
  return `- ${type} — ${BLOCK_CATALOG[type].description} data: { ${blockDataHint(type)} }`;
}

export function allBlockTypesHint(): string {
  return BLOCK_TYPES.map(blockTypeLine).join('\n');
}

export function allEdgeTypesHint(): string {
  return EDGE_TYPES.map((t) => `- ${t} — ${EDGE_TYPE_INFO[t].description}`).join('\n');
}

/** Full catalog as JSON, for `describe_block_schema`. */
export function catalogJson(type?: BlockType) {
  const types = type ? [type] : BLOCK_TYPES;
  return {
    blockTypes: types.map((t) => ({
      type: t,
      label: BLOCK_CATALOG[t].label,
      category: BLOCK_CATALOG[t].category,
      description: BLOCK_CATALOG[t].description,
      whenToUse: BLOCK_CATALOG[t].whenToUse,
      dataFields: BLOCK_CATALOG[t].fields.map((f) => ({
        key: f.key,
        label: f.label,
        kind: f.kind,
        description: f.description,
        ...(f.options ? { options: f.options } : {}),
        ...(f.fields ? { itemFields: f.fields.map((sub) => ({ key: sub.key, kind: sub.kind, description: sub.description })) } : {}),
      })),
    })),
    ...(type
      ? {}
      : {
          edgeTypes: EDGE_TYPES.map((t) => ({
            type: t,
            label: EDGE_TYPE_INFO[t].label,
            description: EDGE_TYPE_INFO[t].description,
            validSources: EDGE_TYPE_INFO[t].validSources ?? 'any',
            validTargets: EDGE_TYPE_INFO[t].validTargets ?? 'any',
          })),
        }),
  };
}
