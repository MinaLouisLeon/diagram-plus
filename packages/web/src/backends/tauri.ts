import {
  BLOCK_CATALOG,
  BLOCK_CATEGORIES,
  DOCUMENT_EXT,
  DesignNotFoundError,
  DesignStore,
  DiagramNotFoundError,
  DiagramStore,
  EDGE_TYPES,
  EDGE_TYPE_INFO,
  ELEMENT_CATEGORIES,
  RevisionConflictError,
  applyBatch,
  assignDiagramContent,
  autoLayout,
  catalogList,
  designProgress,
  diffDesign,
  editDesign,
  elementCatalogList,
  exportDiagram,
  generateSpec,
  importDiagram,
  layoutDesign,
  reconcileDesign,
  safeParseDesign,
  safeParseDiagram,
  validateDiagram,
  type BatchOperation,
  type DesignDocument,
  type DesignOperation,
  type Diagram,
  type DiagramFs,
  type DocumentKind,
} from '@diagram-plus/core/browser';
import { invoke, listen, project } from '../desktop';
import {
  ApiError,
  type Api,
  type Backend,
  type Catalog,
  type LiveConnection,
  type LiveMessage,
  type LiveStatus,
} from './types';

/**
 * The desktop backend.
 *
 * The same `DiagramStore` the `dgp` server runs is instantiated here, in the
 * webview, over a filesystem that forwards to Rust. So the write queue, the
 * revision check and the slug rules are literally the same code in both
 * shells — only the bytes' route to disk differs.
 */

class NoProjectError extends ApiError {
  constructor() {
    super(409, 'No project folder is open.');
  }
}

/** Filesystem backed by the Rust side's current project. */
class TauriDiagramFs implements DiagramFs {
  get root(): string {
    return project.getState().root ?? '';
  }

  get dir(): string {
    return project.getState().dir ?? '';
  }

  private requireProject(): void {
    if (!project.getState().root) throw new NoProjectError();
  }

  fileForSlug(slug: string, kind: DocumentKind = 'diagram'): string {
    const { dir, sep } = project.getState();
    const name = `${slug}${DOCUMENT_EXT[kind]}`;
    return dir ? `${dir}${sep}${name}` : name;
  }

  async ensureDir(): Promise<void> {
    this.requireProject();
    await invoke('diagrams_ensure_dir');
  }

  async listSlugs(kind: DocumentKind = 'diagram'): Promise<string[]> {
    if (!project.getState().root) return [];
    return invoke<string[]>('diagrams_list_slugs', { kind });
  }

  async read(slug: string, kind: DocumentKind = 'diagram'): Promise<string | null> {
    this.requireProject();
    return invoke<string | null>('diagrams_read', { slug, kind });
  }

  async write(slug: string, contents: string, kind: DocumentKind = 'diagram'): Promise<void> {
    this.requireProject();
    await invoke('diagrams_write', { slug, contents, kind });
  }

  async remove(slug: string, kind: DocumentKind = 'diagram'): Promise<void> {
    this.requireProject();
    await invoke('diagrams_remove', { slug, kind });
  }
}

// One filesystem, two stores — the same pairing the server makes, so the
// desktop app and the browser behave identically down to the write queue.
const projectFs = new TauriDiagramFs();
const store = new DiagramStore(projectFs);
const designs = new DesignStore(projectFs);

/**
 * Translate store failures into the status codes the editor already handles —
 * 404 for a missing diagram, 409 for a revision conflict, which is what makes
 * `store.ts` reload instead of showing an error.
 */
function rethrow(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof DiagramNotFoundError) throw new ApiError(404, err.message);
  if (err instanceof DesignNotFoundError) throw new ApiError(404, err.message);
  if (err instanceof RevisionConflictError) throw new ApiError(409, err.message);
  throw new ApiError(500, err instanceof Error ? err.message : String(err));
}

async function read(ref: string): Promise<Diagram> {
  try {
    return await store.read(ref);
  } catch (err) {
    return rethrow(err);
  }
}

async function write(ref: string, mutator: (draft: Diagram) => void): Promise<Diagram> {
  try {
    const { diagram } = await store.update(ref, mutator);
    changed(diagram, 'api');
    return diagram;
  } catch (err) {
    return rethrow(err);
  }
}

const api: Api = {
  async catalog(): Promise<Catalog> {
    return {
      blockTypes: catalogList(),
      categories: BLOCK_CATEGORIES,
      edgeTypes: EDGE_TYPES.map((type) => EDGE_TYPE_INFO[type]),
      colors: Object.fromEntries(
        Object.entries(BLOCK_CATALOG).map(([type, info]) => [type, info.color]),
      ),
      elementTypes: elementCatalogList(),
      elementCategories: ELEMENT_CATEGORIES,
    };
  },

  async listDiagrams() {
    try {
      return { diagrams: await store.list() };
    } catch (err) {
      return rethrow(err);
    }
  },

  async getDiagram(slug) {
    return { diagram: await read(slug) };
  },

  async createDiagram(body) {
    const name = body.name.trim();
    if (!name) throw new ApiError(400, 'A diagram name is required.');
    try {
      const { diagram } = await store.create({
        name,
        description: body.description,
        projectGoal: body.projectGoal,
      });
      changed(diagram, 'api');
      return { diagram };
    } catch (err) {
      return rethrow(err);
    }
  },

  async deleteDiagram(slug) {
    try {
      const result = await store.delete(slug);
      deleted(result.slug);
      return { deleted: result.slug };
    } catch (err) {
      return rethrow(err);
    }
  },

  async patchDiagram(slug, body) {
    if (typeof body['name'] === 'string' && body['name'].trim()) {
      try {
        const renamed = await store.rename(slug, body['name'].trim());
        changed(renamed.diagram, 'api');
        if (renamed.diagram.slug !== slug) deleted(slug);
        const rest = { ...body };
        delete rest['name'];
        if (Object.keys(rest).length === 0) return { diagram: renamed.diagram };
        return { diagram: await applyMeta(renamed.diagram.slug, rest) };
      } catch (err) {
        return rethrow(err);
      }
    }
    return { diagram: await applyMeta(slug, body) };
  },

  async replaceDiagram(slug, incoming) {
    const parsed = safeParseDiagram(incoming);
    if (!parsed.success) {
      throw new ApiError(
        400,
        `Diagram is not valid: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    const next = parsed.data;
    return {
      diagram: await write(slug, (draft) => assignDiagramContent(draft, next)),
    };
  },

  async importDiagram(body) {
    const parsed = safeParseDiagram(body.diagram);
    if (!parsed.success) {
      throw new ApiError(
        400,
        `That is not a diagram: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    if (body.action === 'replace' && !body.target) {
      throw new ApiError(400, 'Replacing needs a diagram to replace.');
    }

    try {
      const outcome = await importDiagram(store, {
        incoming: parsed.data,
        action: body.action,
        target: body.target,
      });
      changed(outcome.diagram, 'api');
      return { diagram: outcome.diagram, action: outcome.action, replaced: outcome.replaced };
    } catch (err) {
      return rethrow(err);
    }
  },

  async batch(slug, operations: BatchOperation[], layout = false) {
    let outcome: ReturnType<typeof applyBatch> | null = null;
    const diagram = await write(slug, (draft) => {
      outcome = applyBatch(draft, operations);
      if (layout) autoLayout(draft);
    });
    return { diagram, result: outcome ?? { applied: 0, errors: [] } };
  },

  async layout(slug, direction) {
    return {
      diagram: await write(slug, (draft) => {
        autoLayout(draft, { direction });
      }),
    };
  },

  async spec(slug) {
    const diagram = await read(slug);
    const design = await designs.find(diagram.slug).catch(() => null);
    return { markdown: generateSpec(diagram, { includeDiagram: true, design }) };
  },

  async validate(slug) {
    return { validation: validateDiagram(await read(slug)) };
  },

  async export(slug, format) {
    return { format, content: exportDiagram(await read(slug), format) };
  },

  /* ---- the screen designs ------------------------------------------- */

  async getDesign(slug) {
    const diagram = await read(slug);
    try {
      const design = await designs.ensure(diagram);
      return {
        design,
        changes: diffDesign(diagram, design),
        progress: designProgress(diagram, design),
        saved: await designs.exists(diagram.slug),
      };
    } catch (err) {
      return rethrow(err);
    }
  },

  async replaceDesign(slug, incoming) {
    const parsed = safeParseDesign(incoming);
    if (!parsed.success) {
      throw new ApiError(
        400,
        `That is not a design document: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
      );
    }
    const next = parsed.data;
    return writeDesign(slug, (draft) => {
      // Identity stays with the file, never with the payload.
      Object.assign(draft, next, {
        slug: draft.slug,
        diagramId: draft.diagramId,
        revision: draft.revision,
        createdAt: draft.createdAt,
      });
    });
  },

  async designOps(slug, operations: DesignOperation[], layout = false) {
    let outcome: { applied: number; errors: unknown[]; corrections: string[] } = {
      applied: 0,
      errors: [],
      corrections: [],
    };
    const result = await writeDesign(slug, (draft) => {
      const edit = editDesign(draft, operations);
      outcome = { applied: edit.applied, errors: edit.errors, corrections: edit.corrections };
      Object.assign(draft, edit.document);
      if (layout) Object.assign(draft, layoutDesign(draft));
    });
    return { ...result, result: outcome };
  },

  async syncDesign(slug, rebuild = false) {
    let report = { added: [] as string[], updated: [] as string[], orphaned: [] as string[] };
    const diagram = await read(slug);
    const result = await writeDesign(
      slug,
      (draft) => {
        const base = rebuild ? { ...draft, screens: [] } : draft;
        const reconciled = reconcileDesign(diagram, base);
        report = {
          added: reconciled.added,
          updated: reconciled.updated,
          orphaned: reconciled.orphaned,
        };
        Object.assign(draft, reconciled.document);
      },
      // Start from the file, so a reconcile can report what it seeded.
      { seed: false },
    );
    return { ...result, report };
  },

  async arrangeDesign(slug, includePinned = false) {
    return writeDesign(slug, (draft) => {
      Object.assign(draft, layoutDesign(draft, { includePinned }));
    });
  },
};

/** Read, mutate, write for the design file — the twin of `write` above. */
async function writeDesign(
  slug: string,
  mutator: (draft: DesignDocument) => void,
  options: { seed?: boolean } = {},
): Promise<{ design: DesignDocument; changes: ReturnType<typeof diffDesign> }> {
  const diagram = await read(slug);
  try {
    const { document } = await designs.update(diagram, mutator, options);
    designChanged(document, 'api');
    return { design: document, changes: diffDesign(diagram, document) };
  } catch (err) {
    return rethrow(err);
  }
}

async function applyMeta(slug: string, body: Record<string, unknown>): Promise<Diagram> {
  return write(slug, (draft) => {
    if (typeof body['description'] === 'string') draft.description = body['description'];
    if (typeof body['projectGoal'] === 'string') draft.projectGoal = body['projectGoal'];
    if (typeof body['notes'] === 'string') draft.notes = body['notes'];
    if (typeof body['status'] === 'string') {
      if (!['draft', 'ready', 'implemented'].includes(body['status'])) {
        throw new ApiError(400, `Unknown status "${body['status']}".`);
      }
      draft.status = body['status'] as Diagram['status'];
    }
    if (body['techStack'] && typeof body['techStack'] === 'object') {
      draft.techStack = { ...draft.techStack, ...(body['techStack'] as object) };
    }
    if (body['canvas'] && typeof body['canvas'] === 'object') {
      draft.canvas = { ...draft.canvas, ...(body['canvas'] as object) };
    }
  });
}

/* ------------------------------------------------------------------ *
 * Live updates
 * ------------------------------------------------------------------ *
 *
 * The server broadcasts over a WebSocket; here the same messages are produced
 * locally. Rust watches `.diagrams/` and reports a slug, and our own writes
 * announce themselves directly — the editor cannot tell the difference.
 */

type Subscriber = (message: LiveMessage) => void;
const subscribers = new Set<Subscriber>();

function emit(message: LiveMessage): void {
  for (const subscriber of subscribers) subscriber(message);
}

function changed(diagram: Diagram, source: string): void {
  emit({
    type: 'diagram:changed',
    slug: diagram.slug,
    revision: diagram.revision,
    source,
    diagram,
  });
}

function deleted(slug: string): void {
  emit({ type: 'diagram:deleted', slug });
}

function designChanged(design: DesignDocument, source: string): void {
  emit({
    type: 'design:changed',
    slug: design.slug,
    revision: design.revision,
    source,
    design,
  });
}

/** A file changed underneath us — most likely Claude, via the MCP server. */
async function onFileChanged(slug: string): Promise<void> {
  const diagram = await store.readBySlug(slug).catch(() => null);
  if (diagram) changed(diagram, 'external');
}

async function onDesignFileChanged(slug: string): Promise<void> {
  const design = await designs.find(slug).catch(() => null);
  if (design) designChanged(design, 'external');
}

function connectLive(
  onMessage: (message: LiveMessage) => void,
  onStatus: (status: LiveStatus) => void,
): LiveConnection {
  subscribers.add(onMessage);
  onStatus('connecting');

  let closed = false;
  const unlisten: (() => void)[] = [];

  const track = (promise: Promise<() => void>) => {
    void promise.then((off) => (closed ? off() : unlisten.push(off)));
  };

  track(listen('diagram-changed', (payload) => void onFileChanged(String(payload))));
  track(listen('diagram-removed', (payload) => deleted(String(payload))));
  track(listen('design-changed', (payload) => void onDesignFileChanged(String(payload))));
  track(
    listen('design-removed', (payload) =>
      emit({ type: 'design:deleted', slug: String(payload) }),
    ),
  );

  // Re-announce the list whenever the project changes, the way the server's
  // `hello` frame does for a newly connected tab.
  const hello = async () => {
    const diagrams = await store.list().catch(() => []);
    onMessage({ type: 'hello', diagrams, root: project.getState().root ?? '' });
    onStatus('open');
  };
  void hello();
  track(listen('project-changed', () => void hello()));

  return {
    close: () => {
      closed = true;
      subscribers.delete(onMessage);
      for (const off of unlisten) off();
      onStatus('closed');
    },
  };
}

export const tauriBackend: Backend = { api, connectLive };
