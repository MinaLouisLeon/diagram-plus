import {
  DiagramSchema,
  parseDiagram,
  summarize,
  type Diagram,
  type DiagramSummary,
} from './diagram.js';
import { nowIso, slugify, uniqueSlug } from './ids.js';
import { createDiagram, type CreateDiagramInput } from './factory.js';

/**
 * The diagram store, with the filesystem left as a parameter.
 *
 * Everything here is plain TypeScript — no `node:` imports — so the same store
 * runs in Node (behind `node:fs`, see `store.ts`) and inside a webview (behind
 * Tauri's IPC, see the desktop package). That matters because the rules that
 * keep two writers from clobbering each other — the per-diagram write queue,
 * the revision check, unique slugs — are the part you least want two
 * implementations of.
 */

export const DIAGRAM_DIR = '.diagrams';
export const DIAGRAM_EXT = '.diagram.json';

export class DiagramNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(`No diagram matching "${ref}".`);
    this.name = 'DiagramNotFoundError';
  }
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `The diagram changed since you read it (you have revision ${expected}, on disk it is ${actual}). ` +
        `Re-read the diagram and re-apply your change.`,
    );
    this.name = 'RevisionConflictError';
  }
}

/**
 * The filesystem, as the store needs it.
 *
 * Deliberately slug-oriented rather than path-oriented: path handling is the
 * one thing that genuinely differs between a Node process and a webview
 * talking to Rust, so each adapter keeps its own and the store never joins a
 * path itself.
 */
export interface DiagramFs {
  /** Project root holding the diagram directory. Absolute, for display. */
  readonly root: string;
  /** The diagram directory itself. Absolute, for display. */
  readonly dir: string;
  /** Create the diagram directory if it is not there yet. */
  ensureDir(): Promise<void>;
  /** Slugs of the diagram files present, in any order. */
  listSlugs(): Promise<string[]>;
  /** File contents, or `null` when there is no such file. */
  read(slug: string): Promise<string | null>;
  /** Write the file, atomically where the platform allows it. */
  write(slug: string, contents: string): Promise<void>;
  /** Delete the file. Succeeds when it is already gone. */
  remove(slug: string): Promise<void>;
  /** Absolute path of a diagram file, for messages and logs. */
  fileForSlug(slug: string): string;
}

export interface WriteResult {
  diagram: Diagram;
  file: string;
  hash: string;
}

export class DiagramStore {
  readonly fs: DiagramFs;

  /** Serialises writes per slug so two callers cannot interleave. */
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

  async ensureDir(): Promise<void> {
    await this.fs.ensureDir();
  }

  fileForSlug(slug: string): string {
    return this.fs.fileForSlug(slug);
  }

  async listSlugs(): Promise<string[]> {
    return (await this.fs.listSlugs()).slice().sort();
  }

  async list(): Promise<DiagramSummary[]> {
    const slugs = await this.listSlugs();
    const out: DiagramSummary[] = [];
    for (const slug of slugs) {
      const diagram = await this.readBySlug(slug).catch(() => null);
      if (diagram) out.push(summarize(diagram));
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  async readBySlug(slug: string): Promise<Diagram> {
    const text = await this.fs.read(slug);
    if (text === null) throw new DiagramNotFoundError(slug);

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${this.fs.fileForSlug(slug)} is not valid JSON. Fix or delete the file.`);
    }
    const diagram = parseDiagram(raw);
    // The filename is authoritative, so a renamed file still resolves.
    if (diagram.slug !== slug) return { ...diagram, slug };
    return diagram;
  }

  /** Resolve by slug, id, or (case-insensitive) name. */
  async read(ref: string): Promise<Diagram> {
    const trimmed = ref.trim();
    const slugs = await this.listSlugs();
    if (slugs.includes(trimmed)) return this.readBySlug(trimmed);

    const asSlug = slugify(trimmed);
    if (slugs.includes(asSlug)) return this.readBySlug(asSlug);

    for (const slug of slugs) {
      const diagram = await this.readBySlug(slug).catch(() => null);
      if (!diagram) continue;
      if (diagram.id === trimmed) return diagram;
      if (diagram.name.toLowerCase() === trimmed.toLowerCase()) return diagram;
    }
    throw new DiagramNotFoundError(ref);
  }

  async exists(ref: string): Promise<boolean> {
    try {
      await this.read(ref);
      return true;
    } catch {
      return false;
    }
  }

  async create(input: CreateDiagramInput): Promise<WriteResult> {
    await this.ensureDir();
    const slugs = await this.listSlugs();
    const slug = uniqueSlug(input.slug ?? input.name, slugs);
    const diagram = createDiagram({ ...input, slug });
    return this.write(diagram);
  }

  /** Persist a diagram exactly as given (revision is *not* bumped here). */
  async write(diagram: Diagram): Promise<WriteResult> {
    await this.ensureDir();
    const parsed = DiagramSchema.parse(diagram);
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    await this.fs.write(parsed.slug, text);
    return { diagram: parsed, file: this.fs.fileForSlug(parsed.slug), hash: hashContent(text) };
  }

  /**
   * Read → transform → write, serialised per diagram. The mutator may return a
   * new diagram or mutate in place; either way `revision` and `updatedAt` are
   * refreshed automatically.
   */
  async update(
    ref: string,
    mutator: (diagram: Diagram) => Diagram | void | Promise<Diagram | void>,
    options: { expectedRevision?: number } = {},
  ): Promise<WriteResult> {
    return this.enqueue(ref, async () => {
      const current = await this.read(ref);
      if (
        options.expectedRevision !== undefined &&
        options.expectedRevision !== current.revision
      ) {
        throw new RevisionConflictError(options.expectedRevision, current.revision);
      }
      const draft: Diagram = structuredClone(current);
      const result = await mutator(draft);
      const next = result ?? draft;
      next.revision = current.revision + 1;
      next.updatedAt = nowIso();
      return this.write(next);
    });
  }

  async rename(ref: string, name: string): Promise<WriteResult> {
    const current = await this.read(ref);
    const slugs = (await this.listSlugs()).filter((s) => s !== current.slug);
    const nextSlug = uniqueSlug(name, slugs);

    const written = await this.write({
      ...current,
      name,
      slug: nextSlug,
      revision: current.revision + 1,
      updatedAt: nowIso(),
    });
    if (nextSlug !== current.slug) {
      await this.fs.remove(current.slug);
    }
    return written;
  }

  async delete(ref: string): Promise<{ slug: string; file: string }> {
    const diagram = await this.read(ref);
    const file = this.fs.fileForSlug(diagram.slug);
    await this.fs.remove(diagram.slug);
    return { slug: diagram.slug, file };
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

/**
 * Content fingerprint for a written file.
 *
 * FNV-1a rather than SHA-1: this only ever answers "did these bytes change",
 * it is never a security boundary, and a pure-JS hash keeps `node:crypto` out
 * of the browser bundle.
 */
export function hashContent(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** The slug a diagram filename encodes, or `null` if it is not one. */
export function slugFromFilename(filename: string): string | null {
  const base = filename.replace(/^.*[\\/]/, '');
  if (!base.endsWith(DIAGRAM_EXT)) return null;
  return base.slice(0, -DIAGRAM_EXT.length);
}
