import { z } from 'zod';
import {
  FORMAT_VERSION,
  parseDiagram,
  safeParseDiagram,
  type Diagram,
  type DiagramSummary,
} from './diagram.js';
import { newId, nowIso, slugify, uniqueSlug } from './ids.js';
import { DIAGRAM_EXT, type DiagramStore } from './store-base.js';

/**
 * Moving a diagram between projects.
 *
 * `export.ts` renders a diagram for *reading* — Mermaid, Markdown, JSON to
 * paste into a reply. This is the other direction: a file that goes out of one
 * project and comes back into another still being the same diagram. It exists
 * because the person best placed to draw the design often has the app but not
 * the repository, so the diagram has to travel by email or chat and be merged
 * back in afterwards.
 *
 * A single diagram exports as exactly the bytes that sit in `.diagrams/`, so
 * the file is also a drop-in: someone with the repo can copy it into place and
 * skip the import entirely. A whole project exports as a bundle, which is the
 * same documents in a thin wrapper.
 */

export const BUNDLE_KIND = 'diagram-plus/bundle';
export const BUNDLE_EXT = '.diagrams.json';

export const BundleSchema = z.object({
  kind: z.literal(BUNDLE_KIND),
  formatVersion: z.number().int().default(FORMAT_VERSION),
  exportedAt: z.string().default(''),
  /** Project the bundle came out of. Shown when importing, never acted on. */
  source: z.string().default(''),
  /** Left unknown here so each document goes through `migrate()` on its own. */
  diagrams: z.array(z.unknown()).default([]),
});

export interface Bundle {
  kind: typeof BUNDLE_KIND;
  formatVersion: number;
  exportedAt: string;
  source: string;
  diagrams: Diagram[];
}

export function createBundle(diagrams: Diagram[], options: { source?: string } = {}): Bundle {
  return {
    kind: BUNDLE_KIND,
    formatVersion: FORMAT_VERSION,
    exportedAt: nowIso(),
    source: options.source ?? '',
    diagrams,
  };
}

/** One diagram, in the on-disk format, byte for byte. */
export function serializeDiagramFile(diagram: Diagram): string {
  return `${JSON.stringify(diagram, null, 2)}\n`;
}

export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function diagramFileName(diagram: Diagram): string {
  return `${diagram.slug || slugify(diagram.name)}${DIAGRAM_EXT}`;
}

export function bundleFileName(source: string): string {
  return `${slugify(source || 'diagrams')}${BUNDLE_EXT}`;
}

/* ------------------------------------------------------------------ *
 * Reading a file back
 * ------------------------------------------------------------------ */

/**
 * A file the user chose that turned out not to be a diagram.
 *
 * Separate from a schema error because the message has to be useful to someone
 * who picked the wrong thing out of their Downloads folder, not to a developer.
 */
export class TransferParseError extends Error {
  constructor(
    message: string,
    public readonly file: string = '',
  ) {
    super(message);
    this.name = 'TransferParseError';
  }
}

export interface ParsedTransfer {
  kind: 'diagram' | 'bundle';
  diagrams: Diagram[];
  /** Project name carried by a bundle, if it had one. */
  source: string;
  /**
   * True when the file was written by a later diagram-plus than this one, so
   * anything it added that this version has no field for has been dropped.
   */
  fromNewerFormat: boolean;
}

/**
 * Work out what a picked file is and read the diagrams out of it.
 *
 * Accepts the three shapes that can legitimately turn up: a single diagram
 * document, a bundle, and a bare array of diagrams — the last because it is
 * what someone hand-assembling a file is most likely to write.
 */
export function parseTransfer(text: string, file = ''): ParsedTransfer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TransferParseError(`${label(file)} is not JSON.`, file);
  }

  if (Array.isArray(raw)) {
    return readMany(raw, { file, kind: 'bundle', source: '', formatVersion: FORMAT_VERSION });
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new TransferParseError(`${label(file)} does not contain a diagram.`, file);
  }

  const doc = raw as Record<string, unknown>;

  if (doc['kind'] === BUNDLE_KIND) {
    const bundle = BundleSchema.safeParse(doc);
    if (!bundle.success) {
      throw new TransferParseError(
        `${label(file)} looks like a diagram-plus bundle but could not be read: ` +
          `${bundle.error.issues[0]?.message ?? 'unknown error'}.`,
        file,
      );
    }
    return readMany(bundle.data.diagrams, {
      file,
      kind: 'bundle',
      source: bundle.data.source,
      formatVersion: bundle.data.formatVersion,
    });
  }

  const parsed = safeParseDiagram(doc);
  if (!parsed.success) {
    // A JSON file with none of a diagram's fields is a wrong-file mistake; one
    // with some of them is a damaged diagram, and the schema knows why.
    const looksLikeOne = 'blocks' in doc || 'nodes' in doc || 'formatVersion' in doc;
    throw new TransferParseError(
      looksLikeOne
        ? `${label(file)} is a damaged diagram: ${parsed.error.issues[0]?.message ?? 'unknown error'}.`
        : `${label(file)} is not a diagram-plus diagram.`,
      file,
    );
  }

  return {
    kind: 'diagram',
    diagrams: [parsed.data],
    source: '',
    fromNewerFormat: versionOf(doc) > FORMAT_VERSION,
  };
}

function readMany(
  raws: unknown[],
  context: { file: string; kind: 'bundle'; source: string; formatVersion: number },
): ParsedTransfer {
  if (!raws.length) {
    throw new TransferParseError(`${label(context.file)} contains no diagrams.`, context.file);
  }

  const diagrams: Diagram[] = [];
  let newer = context.formatVersion > FORMAT_VERSION;
  raws.forEach((raw, index) => {
    const parsed = safeParseDiagram(raw);
    if (!parsed.success) {
      throw new TransferParseError(
        `${label(context.file)} holds a damaged diagram at position ${index + 1}: ` +
          `${parsed.error.issues[0]?.message ?? 'unknown error'}.`,
        context.file,
      );
    }
    if (versionOf(raw) > FORMAT_VERSION) newer = true;
    diagrams.push(parsed.data);
  });

  return { kind: context.kind, diagrams, source: context.source, fromNewerFormat: newer };
}

function versionOf(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0;
  const value = (raw as Record<string, unknown>)['formatVersion'];
  return typeof value === 'number' ? value : 0;
}

function label(file: string): string {
  return file ? `“${file}”` : 'That file';
}

/* ------------------------------------------------------------------ *
 * Deciding what to do with what came in
 * ------------------------------------------------------------------ */

/**
 * `replace` overwrites the diagram already here; `copy` adds it alongside;
 * `skip` leaves it out of this import.
 */
export type ImportAction = 'replace' | 'copy' | 'skip';

export interface ImportCandidate {
  /** The diagram as it came out of the file. */
  incoming: Diagram;
  /** The diagram in this project it collides with, if any. */
  existing: DiagramSummary | null;
  /** What identified the collision. `id` survives a rename, so it wins. */
  matchedBy: 'id' | 'slug' | 'name' | null;
  /** What will happen unless the user says otherwise. */
  action: ImportAction;
  /** File it arrived in, so a multi-file import can say where each came from. */
  file: string;
}

/**
 * Pair each incoming diagram with the one it would land on.
 *
 * The default for a collision is `replace`, because the round trip this whole
 * feature exists for — send it out, get it back edited — ends in a replace
 * every time. It is only ever a default: nothing is written until the user has
 * seen both sides.
 */
export function planImport(
  incoming: { diagram: Diagram; file?: string }[],
  existing: DiagramSummary[],
): ImportCandidate[] {
  return incoming.map(({ diagram, file = '' }) => {
    const byId = existing.find((candidate) => candidate.id === diagram.id);
    const bySlug = byId ? null : existing.find((candidate) => candidate.slug === diagram.slug);
    const byName = byId || bySlug
      ? null
      : existing.find(
          (candidate) => candidate.name.toLowerCase() === diagram.name.trim().toLowerCase(),
        );

    const match = byId ?? bySlug ?? byName ?? null;
    const matchedBy = byId ? 'id' : bySlug ? 'slug' : byName ? 'name' : null;

    return {
      incoming: diagram,
      existing: match,
      matchedBy,
      action: match ? 'replace' : 'copy',
      file,
    };
  });
}


/**
 * Copy the parts of a diagram that are *content* onto another.
 *
 * Everything a person edits, and nothing that identifies the document: id,
 * slug, revision and createdAt belong to the file being written into, not to
 * the one arriving. Kept in one place because every whole-document write in
 * the codebase needs exactly this list, and a field added to the schema but
 * missed in one of them would silently fail to survive a save.
 */
export function assignDiagramContent(draft: Diagram, next: Diagram): void {
  draft.name = next.name;
  draft.description = next.description;
  draft.projectGoal = next.projectGoal;
  draft.techStack = next.techStack;
  draft.status = next.status;
  draft.blocks = next.blocks;
  draft.edges = next.edges;
  draft.groups = next.groups;
  draft.canvas = next.canvas;
  draft.notes = next.notes;
  // The client view travels with the diagram: it is the same file, and losing
  // it on a save would throw away a whole review.
  draft.clientView = next.clientView;
}

/**
 * The name and slug an import will land under.
 *
 * Pure, and shared by the dialog and the store, so what the user is told will
 * happen is worked out by the same code that then does it.
 */
export function importTarget(
  incoming: Diagram,
  action: Exclude<ImportAction, 'skip'>,
  existing: { slug: string } | null,
  taken: Iterable<string>,
): { name: string; slug: string } {
  if (action === 'replace') {
    if (!existing) throw new Error('There is no diagram here to replace.');
    return { name: incoming.name, slug: existing.slug };
  }

  // A copy landing next to the original has to be tellable apart at a glance,
  // so it is renamed rather than left as a second row with the same label.
  const name = existing ? `${incoming.name} (imported)` : incoming.name;
  return { name, slug: uniqueSlug(name, taken) };
}

export interface ImportOutcome {
  action: Exclude<ImportAction, 'skip'>;
  diagram: Diagram;
  file: string;
  /** Slug of the diagram that was overwritten, when replacing. */
  replaced: string | null;
}

/**
 * Write one incoming diagram into a project.
 *
 * A replace goes through `store.update`, so it takes the same write queue and
 * revision bump as any other edit and keeps the local identity — same id, same
 * filename. That matters twice: git shows one diagram changed rather than a
 * delete and an add, and the *next* trip out and back still matches by id even
 * if the collaborator renamed it.
 */
export async function importDiagram(
  store: DiagramStore,
  input: {
    incoming: Diagram;
    action: Exclude<ImportAction, 'skip'>;
    /** The diagram to overwrite — slug, id or name. Required to replace. */
    target?: string;
  },
): Promise<ImportOutcome> {
  const { incoming, action } = input;

  if (action === 'replace') {
    if (!input.target) throw new Error('Replacing needs the diagram to replace.');
    const { diagram } = await store.update(input.target, (draft) => {
      assignDiagramContent(draft, incoming);
    });
    return { action, diagram, file: store.fileForSlug(diagram.slug), replaced: diagram.slug };
  }

  const taken = await store.listSlugs();
  const collides = taken.includes(incoming.slug)
    ? { slug: incoming.slug }
    : await store
        .read(incoming.name)
        .then((found) => ({ slug: found.slug }))
        .catch(() => null);
  const target = importTarget(incoming, 'copy', collides, taken);

  const { diagram, file } = await store.write(
    parseDiagram({
      ...incoming,
      id: newId('dgm'),
      name: target.name,
      slug: target.slug,
      createdAt: incoming.createdAt || nowIso(),
      revision: 1,
      updatedAt: nowIso(),
    }),
  );
  return { action, diagram, file, replaced: null };
}
