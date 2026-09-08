import type { Diagram } from './diagram.js';
import { createDesignDocument } from './design-factory.js';
import { relaxArtboards, settleFreePlacement } from './design-ops.js';
import { deriveDesign, reconcileDesign } from './design-sync.js';
import {
  DesignDocumentSchema,
  parseDesign,
  summarizeDesign,
  type DesignDocument,
  type DesignSummary,
} from './design.js';
import { nowIso } from './ids.js';
import {
  RevisionConflictError,
  hashContent,
  type DiagramFs,
} from './store-base.js';

/**
 * The design store.
 *
 * A thin twin of `DiagramStore` over the same filesystem, reading and writing
 * `.diagrams/<slug>.design.json`. It shares the shape rather than the code
 * because the two documents genuinely differ: a design has no slug of its own
 * to make unique, cannot be created without a diagram to hang off, and is
 * allowed not to exist — a project with no designs yet is the normal state,
 * not a missing file.
 *
 * The write queue, the revision check and the atomic write are the same
 * bargain as for diagrams: two writers, one file, last-read-wins refused.
 */

/**
 * Put a document read off disk back inside its own rules.
 *
 * Everything written from here on holds the two invariants — no element placed
 * at x/y outside a frame, no two artboards on top of each other — but files
 * already on disk were written before they existed, and somebody may have
 * hand-edited the JSON. Repairing on the way in means the editor, the spec and
 * the MCP tools all see a document that is true, rather than each having to
 * remember to work around one that is not.
 *
 * Nothing is written here. The next real edit persists the repair.
 */
function repairDesign(document: DesignDocument): DesignDocument {
  let changed = false;
  const screens = document.screens.map((screen) => {
    const { root, settled } = settleFreePlacement(screen.root);
    if (!settled.length) return screen;
    changed = true;
    return { ...screen, root };
  });

  const relaxed = relaxArtboards(changed ? screens : document.screens);
  if (!changed && !relaxed.moved.length) return document;
  return { ...document, screens: relaxed.screens };
}

export class DesignNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`No designs for "${slug}" yet.`);
    this.name = 'DesignNotFoundError';
  }
}

export interface DesignWriteResult {
  document: DesignDocument;
  file: string;
  hash: string;
}

export class DesignStore {
  readonly fs: DiagramFs;
  private queues = new Map<string, Promise<unknown>>();

  constructor(fs: DiagramFs) {
    this.fs = fs;
  }

  get root(): string {
    return this.fs.root;
  }

  get dir(): string {
    return this.fs.dir;
  }

  fileForSlug(slug: string): string {
    return this.fs.fileForSlug(slug, 'design');
  }

  async listSlugs(): Promise<string[]> {
    return (await this.fs.listSlugs('design')).slice().sort();
  }

  async list(): Promise<DesignSummary[]> {
    const out: DesignSummary[] = [];
    for (const slug of await this.listSlugs()) {
      const document = await this.read(slug).catch(() => null);
      if (document) out.push(summarizeDesign(document));
    }
    return out;
  }

  /** `null` when the project has no designs for that diagram yet. */
  async find(slug: string): Promise<DesignDocument | null> {
    const text = await this.fs.read(slug, 'design');
    if (text === null) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(
        `${this.fileForSlug(slug)} is not valid JSON. Fix or delete the file — deleting it only ` +
          `loses the designs, never the diagram.`,
      );
    }
    const document = parseDesign(raw);
    // The filename is authoritative, so a renamed file still resolves.
    const named = document.slug === slug ? document : { ...document, slug };
    return repairDesign(named);
  }

  async read(slug: string): Promise<DesignDocument> {
    const document = await this.find(slug);
    if (!document) throw new DesignNotFoundError(slug);
    return document;
  }

  async exists(slug: string): Promise<boolean> {
    return (await this.fs.read(slug, 'design')) !== null;
  }

  /**
   * The designs for a diagram, seeding them from it the first time.
   *
   * This is the call almost everything makes: opening the design tab, asking
   * for a screen over MCP, generating the spec. A project that has never been
   * designed gets a document derived from the diagram — a wireframe per screen
   * with its fields and buttons already wired — rather than an empty canvas
   * and a shrug.
   *
   * `persist: false` builds it without writing, so *looking* at the designs
   * never creates a file. The first real edit is what commits it.
   */
  async ensure(
    diagram: Diagram,
    options: { persist?: boolean; reconcile?: boolean } = {},
  ): Promise<DesignDocument> {
    const { persist = false, reconcile = false } = options;
    const existing = await this.find(diagram.slug);

    if (!existing) {
      const derived = deriveDesign(diagram);
      return persist ? (await this.write(derived)).document : derived;
    }
    if (!reconcile) return existing;

    const result = reconcileDesign(diagram, existing);
    return persist ? (await this.write(result.document)).document : result.document;
  }

  /** An empty design document for a diagram — no screens, default tokens. */
  async createFor(diagram: Diagram): Promise<DesignWriteResult> {
    return this.write(
      createDesignDocument({
        slug: diagram.slug,
        name: diagram.name,
        diagramId: diagram.id,
      }),
    );
  }

  /** Persist a document exactly as given (revision is *not* bumped here). */
  async write(document: DesignDocument): Promise<DesignWriteResult> {
    await this.fs.ensureDir();
    const parsed = DesignDocumentSchema.parse(document);
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    await this.fs.write(parsed.slug, text, 'design');
    return { document: parsed, file: this.fileForSlug(parsed.slug), hash: hashContent(text) };
  }

  /** A design document for a diagram with no screens in it — tokens only. */
  blankFor(diagram: Diagram): DesignDocument {
    return createDesignDocument({
      slug: diagram.slug,
      name: diagram.name,
      diagramId: diagram.id,
    });
  }

  /**
   * Read → transform → write, serialised per slug.
   *
   * `diagram` is required rather than optional because an update to designs
   * that do not exist yet has to start from something, and the diagram is the
   * only thing that produces something worth editing.
   *
   * `seed` decides what "nothing on disk yet" means. Left on, a first edit
   * lands on wireframes derived from the diagram, which is what every editing
   * tool wants. Turned off, it lands on an empty document — which is what
   * *syncing* wants, since a reconcile against an already-derived document
   * would find nothing to do and report that it had seeded nothing.
   */
  async update(
    diagram: Diagram,
    mutator: (document: DesignDocument) => DesignDocument | void | Promise<DesignDocument | void>,
    options: { expectedRevision?: number; seed?: boolean } = {},
  ): Promise<DesignWriteResult> {
    return this.enqueue(diagram.slug, async () => {
      const current =
        options.seed === false
          ? ((await this.find(diagram.slug)) ?? this.blankFor(diagram))
          : await this.ensure(diagram);
      if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
        throw new RevisionConflictError(options.expectedRevision, current.revision);
      }
      const draft: DesignDocument = structuredClone(current);
      const result = await mutator(draft);
      const next = result ?? draft;
      next.revision = current.revision + 1;
      next.updatedAt = nowIso();
      return this.write(next);
    });
  }

  async delete(slug: string): Promise<{ slug: string; file: string }> {
    const file = this.fileForSlug(slug);
    await this.fs.remove(slug, 'design');
    return { slug, file };
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }
}
