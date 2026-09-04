import { BLOCK_TYPES, type BlockType } from './blocks.js';

/**
 * A description of every block type in terms the *editor* and the *MCP server*
 * can both consume. The zod schemas in `blocks.ts` decide what is valid; this
 * file decides how it is presented — which form widget to render, and how to
 * explain the field to Claude.
 *
 * `test/catalog.test.ts` asserts the two stay in sync.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'stringList'
  | 'recordList';

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldKind;
  description: string;
  placeholder?: string;
  options?: readonly string[];
  /** Singular noun for a row of a list, e.g. "field", "step". */
  itemLabel?: string;
  /** Sub-fields, for `recordList`. */
  fields?: FieldDescriptor[];
  monospace?: boolean;
}

export type BlockCategory =
  | 'ui'
  | 'logic'
  | 'data'
  | 'integration'
  | 'flow'
  | 'meta';

export interface BlockTypeInfo {
  type: BlockType;
  label: string;
  icon: string;
  color: string;
  category: BlockCategory;
  description: string;
  /** Guidance shown in the palette and returned by `describe_block_schema`. */
  whenToUse: string;
  defaultName: string;
  fields: FieldDescriptor[];
}

/* ------------------------------------------------------------------ *
 * Reusable descriptor fragments
 * ------------------------------------------------------------------ */

const FIELD_ROW: FieldDescriptor[] = [
  { key: 'name', label: 'Name', kind: 'text', description: 'Field name.' },
  {
    key: 'type',
    label: 'Type',
    kind: 'text',
    description: 'Type as it will appear in code, e.g. string, number, User[].',
  },
  { key: 'required', label: 'Required', kind: 'boolean', description: 'Must always be present.' },
  { key: 'description', label: 'Description', kind: 'text', description: 'What this field holds.' },
  { key: 'example', label: 'Example', kind: 'text', description: 'A sample value.' },
];

function fieldList(key: string, label: string, description: string): FieldDescriptor {
  return { key, label, kind: 'recordList', description, itemLabel: 'field', fields: FIELD_ROW };
}

function stringList(
  key: string,
  label: string,
  description: string,
  itemLabel = 'item',
  monospace = false,
): FieldDescriptor {
  return { key, label, kind: 'stringList', description, itemLabel, monospace };
}

const FUNCTION_ROW: FieldDescriptor[] = [
  { key: 'name', label: 'Name', kind: 'text', description: 'Function name.' },
  { key: 'description', label: 'Description', kind: 'text', description: 'What it does.' },
  { key: 'async', label: 'Async', kind: 'boolean', description: 'Returns a promise.' },
  fieldList('params', 'Parameters', 'Arguments the function takes.'),
  { key: 'returns', label: 'Returns', kind: 'text', description: 'Return type or value.' },
  stringList('steps', 'Steps', 'Pseudo-code, one step per line.', 'step', true),
  stringList('throws', 'Throws', 'Errors this function can raise.', 'error'),
];

/* ------------------------------------------------------------------ *
 * The catalog
 * ------------------------------------------------------------------ */

export const BLOCK_CATALOG: Record<BlockType, BlockTypeInfo> = {
  ui_screen: {
    type: 'ui_screen',
    label: 'Screen',
    icon: '🖥',
    color: '#6366f1',
    category: 'ui',
    description: 'A page or screen the user sees.',
    whenToUse:
      'One per route or page. Give it the route, the state it holds and the actions the user can take.',
    defaultName: 'New Screen',
    fields: [
      { key: 'route', label: 'Route', kind: 'text', description: 'URL path, e.g. /checkout.', monospace: true },
      { key: 'purpose', label: 'Purpose', kind: 'textarea', description: 'What the user accomplishes here.' },
      { key: 'layout', label: 'Layout', kind: 'text', description: 'Layout or template this screen uses.' },
      stringList('components', 'Components', 'Components rendered on this screen.', 'component'),
      fieldList('state', 'State', 'Local state this screen keeps.'),
      {
        key: 'actions',
        label: 'Actions',
        kind: 'recordList',
        description: 'Things the user can do here.',
        itemLabel: 'action',
        fields: [
          { key: 'name', label: 'Name', kind: 'text', description: 'e.g. Submit order.' },
          { key: 'description', label: 'Description', kind: 'text', description: 'What happens.' },
          { key: 'calls', label: 'Calls', kind: 'text', description: 'Block this action calls.' },
        ],
      },
      stringList('permissions', 'Permissions', 'Roles allowed to open this screen.', 'role'),
    ],
  },

  ui_component: {
    type: 'ui_component',
    label: 'Component',
    icon: '🧩',
    color: '#818cf8',
    category: 'ui',
    description: 'A reusable piece of interface.',
    whenToUse: 'For anything rendered inside a screen and reused, with props and events.',
    defaultName: 'NewComponent',
    fields: [
      { key: 'purpose', label: 'Purpose', kind: 'textarea', description: 'What this component is for.' },
      fieldList('props', 'Props', 'Inputs the component accepts.'),
      {
        key: 'emits',
        label: 'Events',
        kind: 'recordList',
        description: 'Events the component raises.',
        itemLabel: 'event',
        fields: [
          { key: 'name', label: 'Name', kind: 'text', description: 'Event name.' },
          { key: 'payload', label: 'Payload', kind: 'text', description: 'Data sent with it.' },
          { key: 'description', label: 'Description', kind: 'text', description: 'When it fires.' },
        ],
      },
      fieldList('state', 'State', 'Internal state.'),
      stringList('variants', 'Variants', 'Visual variants, e.g. primary, ghost.', 'variant'),
    ],
  },

  api_endpoint: {
    type: 'api_endpoint',
    label: 'API Endpoint',
    icon: '🔌',
    color: '#0ea5e9',
    category: 'logic',
    description: 'An HTTP route on the backend.',
    whenToUse:
      'One per route. The method, path, request and response shapes are enough to generate the handler.',
    defaultName: 'New Endpoint',
    fields: [
      {
        key: 'method',
        label: 'Method',
        kind: 'select',
        description: 'HTTP verb.',
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      },
      { key: 'path', label: 'Path', kind: 'text', description: 'e.g. /api/orders/:id', monospace: true },
      {
        key: 'auth',
        label: 'Auth',
        kind: 'select',
        description: 'Who may call this.',
        options: ['none', 'user', 'admin', 'service'],
      },
      { key: 'summary', label: 'Summary', kind: 'textarea', description: 'What the endpoint does.' },
      fieldList('pathParams', 'Path params', 'Parameters embedded in the path.'),
      fieldList('queryParams', 'Query params', 'Query-string parameters.'),
      fieldList('requestBody', 'Request body', 'Body fields the client sends.'),
      {
        key: 'responses',
        label: 'Responses',
        kind: 'recordList',
        description: 'Successful responses.',
        itemLabel: 'response',
        fields: [
          { key: 'status', label: 'Status', kind: 'number', description: 'HTTP status code.' },
          { key: 'description', label: 'Description', kind: 'text', description: 'When it is returned.' },
          fieldList('body', 'Body', 'Fields in the response body.'),
        ],
      },
      {
        key: 'errors',
        label: 'Errors',
        kind: 'recordList',
        description: 'Failure cases.',
        itemLabel: 'error',
        fields: [
          { key: 'status', label: 'Status', kind: 'number', description: 'HTTP status code.' },
          { key: 'code', label: 'Code', kind: 'text', description: 'Application error code.' },
          { key: 'when', label: 'When', kind: 'text', description: 'What triggers it.' },
        ],
      },
      { key: 'notes', label: 'Notes', kind: 'textarea', description: 'Anything else the implementer needs.' },
    ],
  },

  service: {
    type: 'service',
    label: 'Service',
    icon: '⚙️',
    color: '#14b8a6',
    category: 'logic',
    description: 'A module of business logic.',
    whenToUse:
      'Group related functions that belong to one responsibility, e.g. PaymentService.',
    defaultName: 'NewService',
    fields: [
      { key: 'responsibility', label: 'Responsibility', kind: 'textarea', description: 'The one thing this service owns.' },
      {
        key: 'functions',
        label: 'Functions',
        kind: 'recordList',
        description: 'Functions this service exposes.',
        itemLabel: 'function',
        fields: FUNCTION_ROW,
      },
      stringList('dependencies', 'Dependencies', 'Other services or libraries it needs.', 'dependency'),
    ],
  },

  function: {
    type: 'function',
    label: 'Function',
    icon: 'ƒ',
    color: '#22c55e',
    category: 'logic',
    description: 'A single function described as pseudo-code.',
    whenToUse:
      'When one routine deserves its own box — the algorithm matters. Write the body as ordered steps.',
    defaultName: 'newFunction',
    fields: [
      { key: 'language', label: 'Language', kind: 'text', description: 'Optional language hint.' },
      { key: 'signature', label: 'Signature', kind: 'text', description: 'Full signature if you have one.', monospace: true },
      fieldList('params', 'Parameters', 'Arguments.'),
      { key: 'returns', label: 'Returns', kind: 'text', description: 'What it returns.' },
      { key: 'async', label: 'Async', kind: 'boolean', description: 'Returns a promise.' },
      stringList('steps', 'Steps', 'Pseudo-code, one step per line.', 'step', true),
      stringList('throws', 'Throws', 'Errors it can raise.', 'error'),
      { key: 'notes', label: 'Notes', kind: 'textarea', description: 'Edge cases, performance notes.' },
    ],
  },

  data_model: {
    type: 'data_model',
    label: 'Data Model',
    icon: '🗃',
    color: '#f59e0b',
    category: 'data',
    description: 'An entity: a table, collection or type.',
    whenToUse:
      'One per persisted entity. Fields and relations here become your schema or migrations.',
    defaultName: 'NewModel',
    fields: [
      { key: 'storage', label: 'Storage', kind: 'text', description: 'Where it lives, e.g. postgres.' },
      { key: 'tableName', label: 'Table / collection', kind: 'text', description: 'Physical name.', monospace: true },
      fieldList('fields', 'Fields', 'Columns or properties.'),
      {
        key: 'relations',
        label: 'Relations',
        kind: 'recordList',
        description: 'Links to other models.',
        itemLabel: 'relation',
        fields: [
          { key: 'to', label: 'To', kind: 'text', description: 'The other model.' },
          {
            key: 'kind',
            label: 'Kind',
            kind: 'select',
            description: 'Cardinality.',
            options: ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'],
          },
          { key: 'description', label: 'Description', kind: 'text', description: 'What the link means.' },
        ],
      },
      stringList('indexes', 'Indexes', 'Indexes to create.', 'index', true),
      stringList('constraints', 'Constraints', 'Uniqueness, checks, cascade rules.', 'constraint'),
    ],
  },

  datastore: {
    type: 'datastore',
    label: 'Datastore',
    icon: '💾',
    color: '#d97706',
    category: 'data',
    description: 'A database, cache or bucket.',
    whenToUse: 'To show the infrastructure your models live in, and which entities it holds.',
    defaultName: 'Primary database',
    fields: [
      { key: 'engine', label: 'Engine', kind: 'text', description: 'e.g. PostgreSQL 16, Redis, S3.' },
      { key: 'purpose', label: 'Purpose', kind: 'textarea', description: 'What it is used for.' },
      stringList('entities', 'Entities', 'Models stored here.', 'entity'),
      { key: 'notes', label: 'Notes', kind: 'textarea', description: 'Sizing, retention, backups.' },
    ],
  },

  external_service: {
    type: 'external_service',
    label: 'External Service',
    icon: '🌐',
    color: '#a855f7',
    category: 'integration',
    description: 'A third-party API you depend on.',
    whenToUse: 'Stripe, SendGrid, an internal microservice — anything you call but do not build.',
    defaultName: 'External API',
    fields: [
      { key: 'provider', label: 'Provider', kind: 'text', description: 'e.g. Stripe.' },
      {
        key: 'protocol',
        label: 'Protocol',
        kind: 'select',
        description: 'How you talk to it.',
        options: ['http', 'grpc', 'websocket', 'sdk', 'webhook', 'smtp', 'other'],
      },
      {
        key: 'operations',
        label: 'Operations',
        kind: 'recordList',
        description: 'Calls you make against it.',
        itemLabel: 'operation',
        fields: [
          { key: 'name', label: 'Name', kind: 'text', description: 'Operation name.' },
          { key: 'description', label: 'Description', kind: 'text', description: 'What it does.' },
        ],
      },
      { key: 'authMethod', label: 'Auth', kind: 'text', description: 'API key, OAuth, mTLS…' },
      stringList('envKeys', 'Env keys', 'Environment variables it needs.', 'key', true),
    ],
  },

  job: {
    type: 'job',
    label: 'Job',
    icon: '⏱',
    color: '#ef4444',
    category: 'logic',
    description: 'Background or scheduled work.',
    whenToUse: 'Cron tasks, queue workers, webhook handlers — anything not driven by a user request.',
    defaultName: 'New Job',
    fields: [
      {
        key: 'trigger',
        label: 'Trigger',
        kind: 'select',
        description: 'What starts it.',
        options: ['cron', 'queue', 'webhook', 'manual', 'startup', 'event'],
      },
      { key: 'schedule', label: 'Schedule', kind: 'text', description: 'Cron expression or interval.', monospace: true },
      stringList('steps', 'Steps', 'What the job does, in order.', 'step', true),
      { key: 'idempotent', label: 'Idempotent', kind: 'boolean', description: 'Safe to run twice.' },
      { key: 'retries', label: 'Retries', kind: 'number', description: 'How many times to retry.' },
      { key: 'notes', label: 'Notes', kind: 'textarea', description: 'Timeouts, locking, alerting.' },
    ],
  },

  event: {
    type: 'event',
    label: 'Event',
    icon: '📣',
    color: '#ec4899',
    category: 'integration',
    description: 'A message published and consumed asynchronously.',
    whenToUse: 'When parts of the system talk without calling each other directly.',
    defaultName: 'new.event',
    fields: [
      { key: 'channel', label: 'Channel', kind: 'text', description: 'Topic, queue or channel name.', monospace: true },
      fieldList('payload', 'Payload', 'Fields carried by the event.'),
      stringList('producers', 'Producers', 'Blocks that emit it.', 'producer'),
      stringList('consumers', 'Consumers', 'Blocks that handle it.', 'consumer'),
      {
        key: 'deliveryGuarantee',
        label: 'Delivery',
        kind: 'select',
        description: 'Delivery semantics.',
        options: ['at-most-once', 'at-least-once', 'exactly-once', 'unspecified'],
      },
    ],
  },

  decision: {
    type: 'decision',
    label: 'Decision',
    icon: '🔀',
    color: '#eab308',
    category: 'flow',
    description: 'A branch in the flow.',
    whenToUse: 'When the path forks. Connect each branch with a conditional edge.',
    defaultName: 'Decision',
    fields: [
      { key: 'condition', label: 'Condition', kind: 'textarea', description: 'The question being asked.' },
      {
        key: 'branches',
        label: 'Branches',
        kind: 'recordList',
        description: 'Possible outcomes.',
        itemLabel: 'branch',
        fields: [
          { key: 'label', label: 'Label', kind: 'text', description: 'e.g. yes / no.' },
          { key: 'when', label: 'When', kind: 'text', description: 'Condition for this branch.' },
          { key: 'description', label: 'Description', kind: 'text', description: 'What happens next.' },
        ],
      },
    ],
  },

  loop: {
    type: 'loop',
    label: 'Loop',
    icon: '🔁',
    color: '#84cc16',
    category: 'flow',
    description: 'Repeated work.',
    whenToUse: 'When something happens per item or until a condition holds.',
    defaultName: 'Loop',
    fields: [
      { key: 'over', label: 'Over', kind: 'text', description: 'Collection being iterated.' },
      { key: 'condition', label: 'While', kind: 'text', description: 'Continue while this holds.' },
      stringList('body', 'Body', 'Steps repeated each iteration.', 'step', true),
      { key: 'maxIterations', label: 'Max iterations', kind: 'text', description: 'Safety limit, if any.' },
    ],
  },

  config: {
    type: 'config',
    label: 'Config',
    icon: '🔑',
    color: '#64748b',
    category: 'meta',
    description: 'Environment variables and settings.',
    whenToUse: 'Collect the keys the app needs so nothing is missing at run time.',
    defaultName: 'Configuration',
    fields: [
      {
        key: 'keys',
        label: 'Keys',
        kind: 'recordList',
        description: 'Settings the application reads.',
        itemLabel: 'key',
        fields: [
          { key: 'name', label: 'Name', kind: 'text', description: 'e.g. DATABASE_URL.', monospace: true },
          { key: 'description', label: 'Description', kind: 'text', description: 'What it configures.' },
          { key: 'required', label: 'Required', kind: 'boolean', description: 'App will not start without it.' },
          { key: 'secret', label: 'Secret', kind: 'boolean', description: 'Must never be committed.' },
          { key: 'example', label: 'Example', kind: 'text', description: 'A safe sample value.' },
        ],
      },
    ],
  },

  note: {
    type: 'note',
    label: 'Note',
    icon: '📝',
    color: '#94a3b8',
    category: 'meta',
    description: 'A sticky note on the canvas.',
    whenToUse: 'Context, open questions, reminders — anything not part of the system itself.',
    defaultName: 'Note',
    fields: [{ key: 'text', label: 'Text', kind: 'textarea', description: 'The note.' }],
  },

  custom: {
    type: 'custom',
    label: 'Custom',
    icon: '✳️',
    color: '#78716c',
    category: 'meta',
    description: 'Anything the other types do not cover.',
    whenToUse: 'An escape hatch: label the kind yourself and add free key/value details.',
    defaultName: 'Custom Block',
    fields: [
      { key: 'kindLabel', label: 'Kind', kind: 'text', description: 'What kind of thing this is.' },
      {
        key: 'entries',
        label: 'Details',
        kind: 'recordList',
        description: 'Free-form key/value details.',
        itemLabel: 'detail',
        fields: [
          { key: 'key', label: 'Key', kind: 'text', description: 'Detail name.' },
          { key: 'value', label: 'Value', kind: 'text', description: 'Detail value.' },
        ],
      },
    ],
  },
};

export const BLOCK_CATEGORIES: { id: BlockCategory; label: string }[] = [
  { id: 'ui', label: 'Interface' },
  { id: 'logic', label: 'Logic' },
  { id: 'data', label: 'Data' },
  { id: 'integration', label: 'Integration' },
  { id: 'flow', label: 'Flow' },
  { id: 'meta', label: 'Meta' },
];

export function blockInfo(type: BlockType): BlockTypeInfo {
  return BLOCK_CATALOG[type];
}

export function catalogList(): BlockTypeInfo[] {
  return BLOCK_TYPES.map((t) => BLOCK_CATALOG[t]);
}
