import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DiagramSchema, parseDiagram, summarize, type Diagram, type DiagramSummary } from './diagram.js';
import { nowIso, slugify, uniqueSlug } from './ids.js';
import { createDiagram, type CreateDiagramInput } from './factory.js';

/**
 * The file store.
 *
 * Diagrams live as pretty-printed JSON under `.diagrams/` in the user's project
 * so they can be committed alongside the code they describe. The file is the
 * single source of truth: the editor and the MCP server both go through here,
 * which is what makes "Claude edits it / you edit it" work without a database.
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

export interface StoreOptions {
  /** Project root. `.diagrams/` is created inside it. */
  root: string;
  dirName?: string;
}

export interface WriteResult {
  diagram: Diagram;
  file: string;
  hash: string;
}

export class DiagramStore {
  readonly root: string;
  readonly dir: string;

  /** Serialises writes per slug so two callers cannot interleave. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(options: StoreOptions) {
    this.root = path.resolve(options.root);
    this.dir = path.join(this.root, options.dirName ?? DIAGRAM_DIR);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  fileForSlug(slug: string): string {
    return path.join(this.dir, `${slug}${DIAGRAM_EXT}`);
  }

  async listSlugs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter((e) => e.endsWith(DIAGRAM_EXT))
        .map((e) => e.slice(0, -DIAGRAM_EXT.length))
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
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
    const file = this.fileForSlug(slug);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new DiagramNotFoundError(slug);
      }
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${file} is not valid JSON. Fix or delete the file.`);
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
    const file = this.fileForSlug(parsed.slug);
    const text = `${JSON.stringify(parsed, null, 2)}\n`;
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
    return { diagram: parsed, file, hash: hashContent(text) };
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
    const oldFile = this.fileForSlug(current.slug);

    const written = await this.write({
      ...current,
      name,
      slug: nextSlug,
      revision: current.revision + 1,
      updatedAt: nowIso(),
    });
    if (nextSlug !== current.slug) {
      await fs.rm(oldFile, { force: true });
    }
    return written;
  }

  async delete(ref: string): Promise<{ slug: string; file: string }> {
    const diagram = await this.read(ref);
    const file = this.fileForSlug(diagram.slug);
    await fs.rm(file, { force: true });
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

export function hashContent(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/**
 * Walk up from `start` looking for a project root: an existing `.diagrams/`
 * directory, else a `package.json` / `.git`. Falls back to `start`.
 */
export async function findProjectRoot(start: string = process.cwd()): Promise<string> {
  let dir = path.resolve(start);
  const markers = [DIAGRAM_DIR, '.git', 'package.json'];
  for (;;) {
    for (const marker of markers) {
      try {
        await fs.stat(path.join(dir, marker));
        return dir;
      } catch {
        /* keep looking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}
