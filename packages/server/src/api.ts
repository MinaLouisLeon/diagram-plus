import {
  BLOCK_CATALOG,
  BLOCK_CATEGORIES,
  DesignNotFoundError,
  DesignStore,
  DiagramNotFoundError,
  DiagramStore,
  ELEMENT_CATEGORIES,
  EDGE_TYPE_INFO,
  EDGE_TYPES,
  RevisionConflictError,
  applyBatch,
  applyClientView,
  assignDiagramContent,
  autoLayout,
  buildOrder,
  buildProjectTree,
  catalogList,
  describeClientViewDiff,
  deriveClientView,
  designProgress,
  diffDesign,
  editDesign,
  elementCatalogList,
  diagramStats,
  diffClientView,
  exportDiagram,
  ensureClientView,
  generateSpec,
  importDiagram,
  isExportFormat,
  layoutDesign,
  parseTreeOptions,
  reconcileClientView,
  reconcileDesign,
  safeParseDesign,
  safeParseDiagram,
  validateDiagram,
  type BatchOperation,
  type DesignDocument,
  type DesignOperation,
  type Diagram,
  type ExportFormat,
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
  /** The screen designs beside each diagram. */
  designs: DesignStore;
  /** Called after any successful write so the change can be broadcast. */
  onChange?: (diagram: Diagram) => void;
  onDesignChange?: (design: DesignDocument) => void;
  onDelete?: (slug: string) => void;
}

function wrapStoreError(err: unknown): never {
  if (err instanceof DiagramNotFoundError) throw new HttpError(404, err.message);
  if (err instanceof DesignNotFoundError) throw new HttpError(404, err.message);
  if (err instanceof RevisionConflictError) throw new HttpError(409, err.message);
  throw err;
}

export function createApiRouter(options: ApiOptions): Router {
  const { store, designs, onChange, onDesignChange, onDelete } = options;
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
    elementTypes: elementCatalogList(),
    elementCategories: ELEMENT_CATEGORIES,
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
    // The designs live in their own file, so the spec has to go and fetch
    // them. A project with none simply gets the graph, as it always did.
    const design =
      ctx.query.get('design') === 'false'
        ? null
        : await designs.find(diagram.slug).catch(() => null);
    const markdown = generateSpec(diagram, {
      includeDiagram: ctx.query.get('diagram') !== 'false',
      design,
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
    if (!isExportFormat(format)) {
      throw new HttpError(400, `Unknown export format "${format}".`);
    }
    const diagram = await read(ctx.params['slug']!);
    const content = exportDiagram(
      diagram,
      format as ExportFormat,
      parseTreeOptions((key) => ctx.query.get(key)),
    );
    if (ctx.query.get('download') === 'true') {
      const type = format === 'json' ? 'application/json' : 'text/plain';
      return new RawResponse(content, `${type}; charset=utf-8`);
    }
    return { format, content };
  });

  /**
   * The client view as data rather than as text, so the editor can draw it as
   * a real tree — collapsible, and clickable back onto the canvas.
   */
  router.get('/api/diagrams/:slug/tree', async (ctx) => {
    const diagram = await read(ctx.params['slug']!);
    return { tree: buildProjectTree(diagram, parseTreeOptions((key) => ctx.query.get(key))) };
  });

  /* ---- the client view --------------------------------------------- */

  /**
   * The other document: boxes and arrows in plain language, which the client
   * edits during a review. It lives inside the diagram file, so an ordinary
   * save persists it and the live socket carries it to anyone else watching.
   */
  router.get('/api/diagrams/:slug/client-view', async (ctx) => {
    const diagram = await read(ctx.params['slug']!);
    const options = parseTreeOptions((key) => ctx.query.get(key));
    const view = diagram.clientView
      ? diagram.clientView
      : deriveClientView(diagram, options);
    return { clientView: view, changes: diffClientView(diagram, view) };
  });

  /** Rebuild it from the diagram, keeping everything the client did to it. */
  router.post('/api/diagrams/:slug/client-view/sync', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const options = parseTreeOptions((key) => {
      const value = (body as Record<string, unknown>)[key];
      return value === undefined || value === null ? ctx.query.get(key) : String(value);
    });

    let report: { added: string[]; updated: string[]; orphaned: string[] } | null = null;
    const diagram = await write(ctx.params['slug']!, (draft) => {
      if (draft.clientView) {
        const result = reconcileClientView(draft, draft.clientView, options);
        draft.clientView = result.view;
        report = { added: result.added, updated: result.updated, orphaned: result.orphaned };
      } else {
        draft.clientView = deriveClientView(draft, options);
        report = { added: [], updated: [], orphaned: [] };
      }
    }, revisionOf(body['expectedRevision']));

    return {
      diagram,
      clientView: diagram.clientView,
      report,
      changes: diffClientView(diagram, ensureClientView(diagram)),
    };
  });

  /** Carry what the client changed into the technical diagram. */
  router.post('/api/diagrams/:slug/client-view/apply', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const includeRemovals = body['includeRemovals'] === true;

    if (body['dryRun'] === true) {
      const diagram = await read(ctx.params['slug']!);
      const result = applyClientView(diagram, { includeRemovals, dryRun: true });
      return { operations: result.operations, summary: result.summary, applied: false };
    }

    let summary = '';
    let operations: unknown[] = [];
    const diagram = await write(ctx.params['slug']!, (draft) => {
      const result = applyClientView(draft, { includeRemovals });
      summary = result.summary;
      operations = result.operations;
    }, revisionOf(body['expectedRevision']));

    return {
      diagram,
      clientView: diagram.clientView,
      operations,
      summary,
      applied: true,
      changes: describeClientViewDiff(diffClientView(diagram, ensureClientView(diagram))),
    };
  });

  /* ---- the screen designs ------------------------------------------- */

  /**
   * The third document: what each screen looks like.
   *
   * Unlike the diagram and the client view, this one lives in its own file
   * beside the diagram — a screen tree dwarfs the graph it belongs to. So it
   * has its own revision, its own conflict check and its own broadcast, and a
   * project that has never been designed simply has no file: reading returns
   * a document derived from the diagram without writing anything, and the
   * first real edit is what commits it.
   */
  const readDesign = async (slug: string): Promise<{ diagram: Diagram; design: DesignDocument }> => {
    const diagram = await read(slug);
    try {
      return { diagram, design: await designs.ensure(diagram) };
    } catch (err) {
      return wrapStoreError(err);
    }
  };

  const writeDesign = async (
    slug: string,
    // The diagram is handed to the mutator rather than closed over, so a
    // route that needs it (a sync reconciles against it) cannot accidentally
    // reference the binding this call is still on its way to producing.
    mutator: (draft: DesignDocument, diagram: Diagram) => void,
    options: { expectedRevision?: number; seed?: boolean } = {},
  ): Promise<{ diagram: Diagram; design: DesignDocument }> => {
    const diagram = await read(slug);
    try {
      const { document } = await designs.update(
        diagram,
        (draft) => mutator(draft, diagram),
        options,
      );
      onDesignChange?.(document);
      return { diagram, design: document };
    } catch (err) {
      return wrapStoreError(err);
    }
  };

  router.get('/api/diagrams/:slug/design', async (ctx) => {
    const { diagram, design } = await readDesign(ctx.params['slug']!);
    return {
      design,
      changes: diffDesign(diagram, design),
      progress: designProgress(diagram, design),
      /** False while the designs are still only derived, never saved. */
      saved: await designs.exists(diagram.slug),
    };
  });

  /**
   * Whole-document replace, as the editor uses for undo/redo and for saving a
   * canvas full of drag operations — sending a reverse operation list would be
   * far more fragile than sending the state.
   */
  router.put('/api/diagrams/:slug/design', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const parsed = safeParseDesign(body['design']);
    if (!parsed.success) {
      throw new HttpError(
        400,
        `That is not a design document: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    const incoming = parsed.data;
    const { diagram, design } = await writeDesign(
      ctx.params['slug']!,
      (draft) => {
        // Identity stays with the file, not the payload: a document pasted in
        // from elsewhere must not be able to rename or re-point this one.
        Object.assign(draft, incoming, {
          slug: draft.slug,
          diagramId: draft.diagramId,
          revision: draft.revision,
          createdAt: draft.createdAt,
        });
      },
      { expectedRevision: revisionOf(body['expectedRevision']) },
    );
    return { design, changes: diffDesign(diagram, design) };
  });

  /** Apply design operations — the same vocabulary the MCP tools use. */
  router.post('/api/diagrams/:slug/design/ops', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const operations = body['operations'];
    if (!Array.isArray(operations)) {
      throw new HttpError(400, 'Expected an "operations" array.');
    }

    let outcome: { applied: number; errors: unknown[] } = { applied: 0, errors: [] };
    const { diagram, design } = await writeDesign(
      ctx.params['slug']!,
      (draft) => {
        const result = editDesign(draft, operations as DesignOperation[]);
        outcome = { applied: result.applied, errors: result.errors };
        Object.assign(draft, result.document);
        if (body['layout'] === true) Object.assign(draft, layoutDesign(draft));
      },
      { expectedRevision: revisionOf(body['expectedRevision']) },
    );
    return { design, result: outcome, changes: diffDesign(diagram, design) };
  });

  /** Seed designs for new screens, keeping everything already drawn. */
  router.post('/api/diagrams/:slug/design/sync', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const rebuild = body['rebuild'] === true;

    let report: { added: string[]; updated: string[]; orphaned: string[] } = {
      added: [],
      updated: [],
      orphaned: [],
    };
    const { diagram, design } = await writeDesign(
      ctx.params['slug']!,
      (draft, source) => {
        // Rebuilding drops the screens and re-seeds every one from the
        // diagram. The tokens survive it: they are the one part of a design
        // that is a decision about the product rather than about a screen,
        // and throwing them away would restyle everything to start again.
        const base = rebuild ? { ...draft, screens: [] } : draft;
        const result = reconcileDesign(source, base);
        report = { added: result.added, updated: result.updated, orphaned: result.orphaned };
        Object.assign(draft, result.document);
      },
      {
        expectedRevision: revisionOf(body['expectedRevision']),
        // Start from what is on disk. Reconciling against an already-derived
        // document would find every screen present and report seeding nothing.
        seed: false,
      },
    );
    return { design, report, changes: diffDesign(diagram, design) };
  });

  router.post('/api/diagrams/:slug/design/layout', async (ctx) => {
    const body = (await ctx.body()) as Record<string, unknown>;
    const includePinned = body['includePinned'] === true;
    const { design } = await writeDesign(ctx.params['slug']!, (draft) => {
      Object.assign(draft, layoutDesign(draft, { includePinned }));
    });
    return { design };
  });

  router.delete('/api/diagrams/:slug/design', async (ctx) => {
    const diagram = await read(ctx.params['slug']!);
    try {
      const result = await designs.delete(diagram.slug);
      return { deleted: result.slug };
    } catch (err) {
      return wrapStoreError(err);
    }
  });

  return router;
}
