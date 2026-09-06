import {
  BLOCK_CATALOG,
  BLOCK_CATEGORIES,
  DiagramNotFoundError,
  DiagramStore,
  EDGE_TYPE_INFO,
  EDGE_TYPES,
  RevisionConflictError,
  applyBatch,
  assignDiagramContent,
  autoLayout,
  buildOrder,
  catalogList,
  diagramStats,
  exportDiagram,
  generateSpec,
  importDiagram,
  safeParseDiagram,
  validateDiagram,
  type BatchOperation,
  type Diagram,
} from '@diagram-plus/core';
import { HttpError, RawResponse, Router } from './http.js';

/**
 * The REST API the editor talks to.
 *
 * Everything the browser does goes through the same `operations` primitives the
 * MCP tools use, so an edit made by dragging a block and an edit made by Claude
 * are indistinguishable by the time they reach the file.
 */

export interface ApiOptions {
  store: DiagramStore;
  /** Called after any successful write so the change can be broadcast. */
  onChange?: (diagram: Diagram) => void;
  onDelete?: (slug: string) => void;
}

function wrapStoreError(err: unknown): never {
  if (err instanceof DiagramNotFoundError) throw new HttpError(404, err.message);
  if (err instanceof RevisionConflictError) throw new HttpError(409, err.message);
  throw err;
}

export function createApiRouter(options: ApiOptions): Router {
  const { store, onChange, onDelete } = options;
  const router = new Router();

  const read = async (ref: string): Promise<Diagram> => {
    try {
      return await store.read(ref);
    } catch (err) {
      return wrapStoreError(err);
    }
  };

  const write = async (
    ref: string,
    mutator: (draft: Diagram) => void,
    expectedRevision?: number,
  ): Promise<Diagram> => {
    try {
      const { diagram } = await store.update(ref, mutator, { expectedRevision });
      onChange?.(diagram);
      return diagram;
    } catch (err) {
      return wrapStoreError(err);
    }
  };

  const revisionOf = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    return undefined;
  };

  /* ---- meta -------------------------------------------------------- */

  router.get('/api/health', () => ({
    ok: true,
    root: store.root,
    directory: store.dir,
  }));

  router.get('/api/catalog', () => ({
    blockTypes: catalogList(),
    categories: BLOCK_CATEGORIES,
    edgeTypes: EDGE_TYPES.map((type) => EDGE_TYPE_INFO[type]),
    colors: Object.fromEntries(
      Object.entries(BLOCK_CATALOG).map(([type, info]) => [type, info.color]),
    ),
  }));

  /* ---- diagrams ---------------------------------------------------- */

  router.get('/api/diagrams', async () => ({ diagrams: await store.list() }));

  router.post('/api/diagrams', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    if (!name) throw new HttpError(400, 'A diagram name is required.');
    const { diagram } = await store.create({
      name,
      description: typeof body['description'] === 'string' ? body['description'] : undefined,
      projectGoal: typeof body['projectGoal'] === 'string' ? body['projectGoal'] : undefined,
      techStack: (body['techStack'] as Record<string, unknown>) ?? undefined,
    });
    onChange?.(diagram);
    return { diagram };
  });

  router.get('/api/diagrams/:slug', async (ctx) => ({
    diagram: await read(ctx.params['slug']!),
  }));

  router.delete('/api/diagrams/:slug', async (ctx) => {
    try {
      const result = await store.delete(ctx.params['slug']!);
      onDelete?.(result.slug);
      return { deleted: result.slug };
    } catch (err) {
      return wrapStoreError(err);
    }
  });

  // Whole-document replace. The editor uses it for undo/redo, where sending a
  // reverse operation list would be far more fragile than sending the state.
  router.put('/api/diagrams/:slug', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const incoming = body['diagram'];
    if (!incoming || typeof incoming !== 'object') {
      throw new HttpError(400, 'Expected a "diagram" object.');
    }
    const parsed = safeParseDiagram(incoming);
    if (!parsed.success) {
      throw new HttpError(400, `Diagram is not valid: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    }
    const next = parsed.data;
    return {
      diagram: await write(
        ctx.params['slug']!,
        (draft) => assignDiagramContent(draft, next),
        revisionOf(body['expectedRevision']),
      ),
    };
  });

  router.patch('/api/diagrams/:slug', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const slug = ctx.params['slug']!;

    if (typeof body['name'] === 'string' && body['name'].trim()) {
      try {
        const renamed = await store.rename(slug, body['name'].trim());
        onChange?.(renamed.diagram);
        if (renamed.diagram.slug !== slug) onDelete?.(slug);
        const rest = { ...body };
        delete rest['name'];
        if (Object.keys(rest).length === 0) return { diagram: renamed.diagram };
        return { diagram: await applyMeta(renamed.diagram.slug, rest) };
      } catch (err) {
        return wrapStoreError(err);
      }
    }
    return { diagram: await applyMeta(slug, body) };
  });

  async function applyMeta(slug: string, body: Record<string, unknown>): Promise<Diagram> {
    return write(
      slug,
      (draft) => {
        if (typeof body['description'] === 'string') draft.description = body['description'];
        if (typeof body['projectGoal'] === 'string') draft.projectGoal = body['projectGoal'];
        if (typeof body['notes'] === 'string') draft.notes = body['notes'];
        if (typeof body['status'] === 'string') {
          if (!['draft', 'ready', 'implemented'].includes(body['status'])) {
            throw new HttpError(400, `Unknown status "${body['status']}".`);
          }
          draft.status = body['status'] as Diagram['status'];
        }
        if (body['techStack'] && typeof body['techStack'] === 'object') {
          draft.techStack = { ...draft.techStack, ...(body['techStack'] as object) };
        }
        if (body['canvas'] && typeof body['canvas'] === 'object') {
          draft.canvas = { ...draft.canvas, ...(body['canvas'] as object) };
        }
      },
      revisionOf(body['expectedRevision']),
    );
  }

  /* ---- editing ------------------------------------------------------ */

  router.post('/api/diagrams/:slug/batch', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const operations = body['operations'];
    if (!Array.isArray(operations)) {
      throw new HttpError(400, 'Expected an "operations" array.');
    }

    let outcome: ReturnType<typeof applyBatch> | null = null;
    const diagram = await write(
      ctx.params['slug']!,
      (draft) => {
        outcome = applyBatch(draft, operations as BatchOperation[]);
        if (body['layout'] === true) autoLayout(draft);
      },
      revisionOf(body['expectedRevision']),
    );
    return { diagram, result: outcome };
  });

  router.post('/api/diagrams/:slug/layout', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const direction = body['direction'] === 'TB' ? 'TB' : 'LR';
    return {
      diagram: await write(ctx.params['slug']!, (draft) => {
        autoLayout(draft, { direction });
      }),
    };
  });

  /* ---- transfer ------------------------------------------------------ */

  /**
   * Bring in a diagram that came from another project.
   *
   * The file is read and the collision worked out on the client, where the
   * user is looking at the dialog; by the time it arrives here the decision has
   * been made and this only has to carry it out. `action` is required rather
   * than defaulted, so an import can never overwrite a diagram by omission.
   */
  router.post('/api/diagrams/import', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const action = body['action'];
    if (action !== 'replace' && action !== 'copy') {
      throw new HttpError(400, 'Expected "action" to be "replace" or "copy".');
    }

    const parsed = safeParseDiagram(body['diagram']);
    if (!parsed.success) {
      throw new HttpError(
        400,
        `That is not a diagram: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }

    const target = typeof body['target'] === 'string' ? body['target'] : undefined;
    if (action === 'replace' && !target) {
      throw new HttpError(400, 'Replacing needs a "target" diagram.');
    }

    try {
      const outcome = await importDiagram(store, { incoming: parsed.data, action, target });
      onChange?.(outcome.diagram);
      return { diagram: outcome.diagram, action: outcome.action, replaced: outcome.replaced };
    } catch (err) {
      return wrapStoreError(err);
    }
  });

  /* ---- derived views ------------------------------------------------ */

  router.get('/api/diagrams/:slug/spec', async (ctx) => {
    const diagram = await read(ctx.params['slug']!);
    const markdown = generateSpec(diagram, {
      includeDiagram: ctx.query.get('diagram') !== 'false',
    });
    if (ctx.query.get('format') === 'text') {
      return new RawResponse(markdown, 'text/markdown; charset=utf-8');
    }
    return { markdown };
  });

  router.get('/api/diagrams/:slug/validate', async (ctx) => ({
    validation: validateDiagram(await read(ctx.params['slug']!)),
  }));

  router.get('/api/diagrams/:slug/stats', async (ctx) => {
    const diagram = await read(ctx.params['slug']!);
    return {
      stats: diagramStats(diagram),
      phases: buildOrder(diagram).phases.map((p) => ({
        index: p.index,
        label: p.label,
        blocks: p.blocks.map((b) => ({ id: b.id, name: b.name, status: b.implementation.status })),
      })),
    };
  });

  router.get('/api/diagrams/:slug/export', async (ctx) => {
    const format = ctx.query.get('format') ?? 'mermaid';
    if (!['mermaid', 'markdown', 'json'].includes(format)) {
      throw new HttpError(400, `Unknown export format "${format}".`);
    }
    const diagram = await read(ctx.params['slug']!);
    const content = exportDiagram(diagram, format as 'mermaid' | 'markdown' | 'json');
    if (ctx.query.get('download') === 'true') {
      const type = format === 'json' ? 'application/json' : 'text/plain';
      return new RawResponse(content, `${type}; charset=utf-8`);
    }
    return { format, content };
  });

  return router;
}
