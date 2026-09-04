import { z } from 'zod';
import {
  FieldSchema,
  FunctionSpecSchema,
  ImplementationSchema,
  PositionSchema,
  RelationSchema,
  SizeSchema,
  HttpMethodSchema,
} from './common.js';

/**
 * The block catalog.
 *
 * Every block has the same envelope (id, name, summary, position, ...) plus a
 * `data` payload whose shape depends on `type`. The typed payload is the whole
 * point of the tool: it is what lets Claude turn a diagram into real routes,
 * schemas and functions instead of re-guessing from prose.
 */

export const BLOCK_TYPES = [
  'ui_screen',
  'ui_component',
  'api_endpoint',
  'service',
  'function',
  'data_model',
  'datastore',
  'external_service',
  'job',
  'event',
  'decision',
  'loop',
  'config',
  'note',
  'custom',
] as const;

export const BlockTypeSchema = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockTypeSchema>;

/* ------------------------------------------------------------------ *
 * Per-type payloads
 * ------------------------------------------------------------------ */

export const UiScreenData = z.object({
  route: z.string().default(''),
  purpose: z.string().default(''),
  layout: z.string().default(''),
  components: z.array(z.string()).default([]),
  state: z.array(FieldSchema).default([]),
  actions: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(''),
        /** Name of the block this action talks to, e.g. an api_endpoint. */
        calls: z.string().default(''),
      }),
    )
    .default([]),
  permissions: z.array(z.string()).default([]),
});

export const UiComponentData = z.object({
  purpose: z.string().default(''),
  props: z.array(FieldSchema).default([]),
  emits: z
    .array(
      z.object({
        name: z.string().min(1),
        payload: z.string().default(''),
        description: z.string().default(''),
      }),
    )
    .default([]),
  state: z.array(FieldSchema).default([]),
  variants: z.array(z.string()).default([]),
});

export const ApiEndpointData = z.object({
  method: HttpMethodSchema.default('GET'),
  path: z.string().default('/'),
  auth: z.enum(['none', 'user', 'admin', 'service']).default('none'),
  summary: z.string().default(''),
  pathParams: z.array(FieldSchema).default([]),
  queryParams: z.array(FieldSchema).default([]),
  requestBody: z.array(FieldSchema).default([]),
  responses: z
    .array(
      z.object({
        status: z.number().int().default(200),
        description: z.string().default(''),
        body: z.array(FieldSchema).default([]),
      }),
    )
    .default([]),
  errors: z
    .array(
      z.object({
        status: z.number().int().default(400),
        code: z.string().default(''),
        when: z.string().default(''),
      }),
    )
    .default([]),
  notes: z.string().default(''),
});

export const ServiceData = z.object({
  responsibility: z.string().default(''),
  functions: z.array(FunctionSpecSchema).default([]),
  dependencies: z.array(z.string()).default([]),
});

export const FunctionData = z.object({
  language: z.string().default(''),
  signature: z.string().default(''),
  params: z.array(FieldSchema).default([]),
  returns: z.string().default(''),
  /** Plain-language pseudo-code. This is the "pseudo code diagram" payload. */
  steps: z.array(z.string()).default([]),
  throws: z.array(z.string()).default([]),
  async: z.boolean().default(false),
  notes: z.string().default(''),
});

export const DataModelData = z.object({
  storage: z.string().default(''),
  tableName: z.string().default(''),
  fields: z.array(FieldSchema).default([]),
  relations: z.array(RelationSchema).default([]),
  indexes: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
});

export const DatastoreData = z.object({
  engine: z.string().default(''),
  purpose: z.string().default(''),
  entities: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export const ExternalServiceData = z.object({
  provider: z.string().default(''),
  protocol: z
    .enum(['http', 'grpc', 'websocket', 'sdk', 'webhook', 'smtp', 'other'])
    .default('http'),
  operations: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(''),
      }),
    )
    .default([]),
  authMethod: z.string().default(''),
  envKeys: z.array(z.string()).default([]),
});

export const JobData = z.object({
  trigger: z
    .enum(['cron', 'queue', 'webhook', 'manual', 'startup', 'event'])
    .default('cron'),
  schedule: z.string().default(''),
  steps: z.array(z.string()).default([]),
  idempotent: z.boolean().default(false),
  retries: z.number().int().min(0).default(0),
  notes: z.string().default(''),
});

export const EventData = z.object({
  channel: z.string().default(''),
  payload: z.array(FieldSchema).default([]),
  producers: z.array(z.string()).default([]),
  consumers: z.array(z.string()).default([]),
  deliveryGuarantee: z
    .enum(['at-most-once', 'at-least-once', 'exactly-once', 'unspecified'])
    .default('unspecified'),
});

export const DecisionData = z.object({
  condition: z.string().default(''),
  branches: z
    .array(
      z.object({
        label: z.string().min(1),
        when: z.string().default(''),
        description: z.string().default(''),
      }),
    )
    .default([]),
});

export const LoopData = z.object({
  over: z.string().default(''),
  condition: z.string().default(''),
  body: z.array(z.string()).default([]),
  maxIterations: z.string().default(''),
});

export const ConfigData = z.object({
  keys: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default(''),
        required: z.boolean().default(true),
        secret: z.boolean().default(false),
        example: z.string().default(''),
      }),
    )
    .default([]),
});

export const NoteData = z.object({
  text: z.string().default(''),
});

export const CustomData = z.object({
  kindLabel: z.string().default(''),
  entries: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string().default(''),
      }),
    )
    .default([]),
});

/** Map from block type to its payload schema. */
export const BLOCK_DATA_SCHEMAS = {
  ui_screen: UiScreenData,
  ui_component: UiComponentData,
  api_endpoint: ApiEndpointData,
  service: ServiceData,
  function: FunctionData,
  data_model: DataModelData,
  datastore: DatastoreData,
  external_service: ExternalServiceData,
  job: JobData,
  event: EventData,
  decision: DecisionData,
  loop: LoopData,
  config: ConfigData,
  note: NoteData,
  custom: CustomData,
} as const satisfies Record<BlockType, z.ZodTypeAny>;

/* ------------------------------------------------------------------ *
 * Block envelope
 * ------------------------------------------------------------------ */

const BlockEnvelope = {
  id: z.string().min(1),
  name: z.string().min(1),
  /** One line the editor shows on the card. */
  summary: z.string().default(''),
  description: z.string().default(''),
  position: PositionSchema.default({ x: 0, y: 0 }),
  size: SizeSchema.default({ width: 280, height: 140 }),
  groupId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  color: z.string().default(''),
  implementation: ImplementationSchema.default({
    status: 'todo',
    files: [],
    notes: '',
    updatedAt: '',
  }),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
};

function blockVariant<T extends BlockType, S extends z.AnyZodObject>(
  type: T,
  data: S,
) {
  return z.object({
    ...BlockEnvelope,
    type: z.literal(type),
    // Every payload field carries a default, so `{}` is always a valid input.
    data: data.default({} as z.input<S>) as z.ZodDefault<S>,
  });
}

export const BlockSchema = z.discriminatedUnion('type', [
  blockVariant('ui_screen', UiScreenData),
  blockVariant('ui_component', UiComponentData),
  blockVariant('api_endpoint', ApiEndpointData),
  blockVariant('service', ServiceData),
  blockVariant('function', FunctionData),
  blockVariant('data_model', DataModelData),
  blockVariant('datastore', DatastoreData),
  blockVariant('external_service', ExternalServiceData),
  blockVariant('job', JobData),
  blockVariant('event', EventData),
  blockVariant('decision', DecisionData),
  blockVariant('loop', LoopData),
  blockVariant('config', ConfigData),
  blockVariant('note', NoteData),
  blockVariant('custom', CustomData),
]);

export type Block = z.infer<typeof BlockSchema>;
export type BlockInput = z.input<typeof BlockSchema>;

/** Narrow a block to one specific type. */
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export function isBlockType<T extends BlockType>(
  block: Block,
  type: T,
): block is BlockOf<T> {
  return block.type === type;
}
