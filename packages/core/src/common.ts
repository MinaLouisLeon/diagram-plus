import { z } from 'zod';

/**
 * Small building blocks reused across several block types. Keeping them in one
 * place is what lets the editor render a consistent form for "a list of fields"
 * no matter which block type it belongs to.
 */

export const FieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().default('string'),
  required: z.boolean().default(false),
  description: z.string().default(''),
  example: z.string().default(''),
});
export type Field = z.infer<typeof FieldSchema>;

export const FunctionSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  params: z.array(FieldSchema).default([]),
  returns: z.string().default(''),
  /** Plain-language pseudo-code, one step per entry. */
  steps: z.array(z.string()).default([]),
  throws: z.array(z.string()).default([]),
  async: z.boolean().default(false),
});
export type FunctionSpec = z.infer<typeof FunctionSpecSchema>;

export const RelationKindSchema = z.enum([
  'one-to-one',
  'one-to-many',
  'many-to-one',
  'many-to-many',
]);
export type RelationKind = z.infer<typeof RelationKindSchema>;

export const RelationSchema = z.object({
  to: z.string().min(1),
  kind: RelationKindSchema.default('one-to-many'),
  description: z.string().default(''),
});
export type Relation = z.infer<typeof RelationSchema>;

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const PositionSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
});
export type Position = z.infer<typeof PositionSchema>;

export const SizeSchema = z.object({
  width: z.number().positive().default(280),
  height: z.number().positive().default(140),
});
export type Size = z.infer<typeof SizeSchema>;

export const ImplementationStatusSchema = z.enum([
  'todo',
  'in_progress',
  'done',
  'blocked',
]);
export type ImplementationStatus = z.infer<typeof ImplementationStatusSchema>;

export const ImplementationSchema = z.object({
  status: ImplementationStatusSchema.default('todo'),
  /** Files that implement this block, relative to the project root. */
  files: z.array(z.string()).default([]),
  notes: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type Implementation = z.infer<typeof ImplementationSchema>;

/**
 * Turn a schema failure into something a reader can act on.
 *
 * Zod's own `message` is the JSON-stringified issue array, which is unreadable
 * in a tool response and buries the one thing that matters: which field was
 * wrong, and what it should have been.
 */
export function describeSchemaError(err: unknown): string {
  if (!(err instanceof z.ZodError)) {
    return err instanceof Error ? err.message : String(err);
  }
  return err.issues
    .map((issue) => {
      const path = issue.path
        .map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`))
        .join('')
        .replace(/^\./, '');
      const where = path ? `\`${path}\`` : 'the payload';
      if (issue.code === 'invalid_type') {
        return `${where}: expected ${issue.expected}, received ${issue.received}`;
      }
      return `${where}: ${issue.message}`;
    })
    .join('; ');
}
