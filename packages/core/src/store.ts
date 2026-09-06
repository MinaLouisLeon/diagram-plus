import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DIAGRAM_DIR,
  DIAGRAM_EXT,
  DiagramStore as BaseDiagramStore,
  type DiagramFs,
} from './store-base.js';

/**
 * The Node filesystem behind the store.
 *
 * Diagrams live as pretty-printed JSON under `.diagrams/` in the user's project
 * so they can be committed alongside the code they describe. The file is the
 * single source of truth: the editor and the MCP server both go through here,
 * which is what makes "Claude edits it / you edit it" work without a database.
 *
 * The store logic itself lives in `store-base.ts`, which knows nothing about
 * Node — see there for why.
 */

export * from './store-base.js';

export interface StoreOptions {
  /** Project root. `.diagrams/` is created inside it. */
  root: string;
  dirName?: string;
}

export class NodeDiagramFs implements DiagramFs {
  readonly root: string;
  readonly dir: string;

  constructor(options: StoreOptions) {
    this.root = path.resolve(options.root);
    this.dir = path.join(this.root, options.dirName ?? DIAGRAM_DIR);
  }

  fileForSlug(slug: string): string {
    return path.join(this.dir, `${slug}${DIAGRAM_EXT}`);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async listSlugs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter((e) => e.endsWith(DIAGRAM_EXT))
        .map((e) => e.slice(0, -DIAGRAM_EXT.length));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async read(slug: string): Promise<string | null> {
    try {
      return await fs.readFile(this.fileForSlug(slug), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(slug: string, contents: string): Promise<void> {
    const file = this.fileForSlug(slug);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, file);
  }

  async remove(slug: string): Promise<void> {
    await fs.rm(this.fileForSlug(slug), { force: true });
  }
}

/**
 * The store, on the local filesystem.
 *
 * Kept as a class taking `{ root }` because that is how the server, the MCP
 * server and the CLI have always constructed it.
 */
export class DiagramStore extends BaseDiagramStore {
  constructor(options: StoreOptions) {
    super(new NodeDiagramFs(options));
  }
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
