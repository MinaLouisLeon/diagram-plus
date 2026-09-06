import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DiagramStore,
  TransferParseError,
  addBlocks,
  createBundle,
  importDiagram,
  importTarget,
  parseTransfer,
  planImport,
  serializeBundle,
  serializeDiagramFile,
  summarize,
  type Diagram,
} from '@diagram-plus/core';
import { tempStore } from './helpers';

/**
 * The round trip this feature exists for: a diagram leaves one project as a
 * file, is edited by someone who does not have the repository, and comes back.
 */

let store: DiagramStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ store, cleanup } = await tempStore());
});
afterEach(() => cleanup());

/** A diagram with something in it, so block counts are meaningful. */
async function seed(name: string): Promise<Diagram> {
  const { diagram } = await store.create({ name });
  const { diagram: withBlocks } = await store.update(diagram.slug, (draft) => {
    addBlocks(draft, [
      { type: 'ui_screen', name: 'Home' },
      { type: 'api_endpoint', name: 'List items' },
    ]);
  });
  return withBlocks;
}

describe('reading a transfer file', () => {
  it('reads back a single diagram it wrote', async () => {
    const diagram = await seed('Shop App');
    const parsed = parseTransfer(serializeDiagramFile(diagram), 'shop-app.diagram.json');

    expect(parsed.kind).toBe('diagram');
    expect(parsed.diagrams).toHaveLength(1);
    expect(parsed.diagrams[0]?.id).toBe(diagram.id);
    expect(parsed.diagrams[0]?.blocks).toHaveLength(2);
    expect(parsed.fromNewerFormat).toBe(false);
  });

  it('reads back a bundle of several', async () => {
    const first = await seed('Shop App');
    const second = await seed('Recipe Box');
    const text = serializeBundle(createBundle([first, second], { source: 'my-project' }));

    const parsed = parseTransfer(text, 'my-project.diagrams.json');
    expect(parsed.kind).toBe('bundle');
    expect(parsed.source).toBe('my-project');
    expect(parsed.diagrams.map((d) => d.name)).toEqual(['Shop App', 'Recipe Box']);
  });

  it('accepts a bare array of diagrams', async () => {
    const diagram = await seed('Shop App');
    const parsed = parseTransfer(JSON.stringify([diagram]), 'hand-written.json');
    expect(parsed.diagrams).toHaveLength(1);
  });

  it('migrates a diagram written by an older version', async () => {
    const diagram = await seed('Shop App');
    const old = { ...diagram, formatVersion: undefined, nodes: diagram.blocks, blocks: undefined };
    const parsed = parseTransfer(JSON.stringify(old), 'old.diagram.json');
    expect(parsed.diagrams[0]?.blocks).toHaveLength(2);
  });

  it('flags a file from a newer version rather than pretending it is intact', async () => {
    const diagram = await seed('Shop App');
    const text = JSON.stringify({ ...diagram, formatVersion: 99 });
    expect(parseTransfer(text, 'future.diagram.json').fromNewerFormat).toBe(true);
  });

  it('names the file when it is not a diagram at all', () => {
    expect(() => parseTransfer('{"hello":"world"}', 'notes.json')).toThrow(TransferParseError);
    expect(() => parseTransfer('{"hello":"world"}', 'notes.json')).toThrow(/notes\.json/);
    expect(() => parseTransfer('not json', 'notes.json')).toThrow(/is not JSON/);
  });

  it('tells a damaged diagram apart from the wrong file', () => {
    expect(() => parseTransfer('{"blocks":[],"name":""}', 'broken.diagram.json')).toThrow(
      /damaged diagram/,
    );
  });
});

describe('planning an import', () => {
  it('matches by id even after the diagram was renamed elsewhere', async () => {
    const mine = await seed('Shop App');
    const theirs: Diagram = { ...mine, name: 'Shop App v2', slug: 'shop-app-v2' };

    const [candidate] = planImport([{ diagram: theirs }], [summarize(mine)]);
    expect(candidate?.matchedBy).toBe('id');
    expect(candidate?.existing?.slug).toBe('shop-app');
    expect(candidate?.action).toBe('replace');
  });

  it('falls back to the file name, then the name', async () => {
    const mine = await seed('Shop App');
    const sameSlug: Diagram = { ...mine, id: 'dgm_other01' };
    expect(planImport([{ diagram: sameSlug }], [summarize(mine)])[0]?.matchedBy).toBe('slug');

    const sameName: Diagram = { ...mine, id: 'dgm_other01', slug: 'somewhere-else' };
    expect(planImport([{ diagram: sameName }], [summarize(mine)])[0]?.matchedBy).toBe('name');
  });

  it('adds a diagram nothing here matches', async () => {
    const mine = await seed('Shop App');
    const unrelated = await seed('Recipe Box');
    const [candidate] = planImport([{ diagram: unrelated }], [summarize(mine)]);
    expect(candidate?.existing).toBeNull();
    expect(candidate?.action).toBe('copy');
  });
});

describe('where an import lands', () => {
  it('keeps the local file name when replacing', async () => {
    const mine = await seed('Shop App');
    const theirs: Diagram = { ...mine, name: 'Shop App v2' };
    expect(importTarget(theirs, 'replace', summarize(mine), ['shop-app'])).toEqual({
      name: 'Shop App v2',
      slug: 'shop-app',
    });
  });

  it('renames a copy so the two are tellable apart', async () => {
    const mine = await seed('Shop App');
    expect(importTarget(mine, 'copy', summarize(mine), ['shop-app'])).toEqual({
      name: 'Shop App (imported)',
      slug: 'shop-app-imported',
    });
  });

  it('leaves the name alone when nothing collides', async () => {
    const mine = await seed('Shop App');
    expect(importTarget(mine, 'copy', null, [])).toEqual({
      name: 'Shop App',
      slug: 'shop-app',
    });
  });
});

describe('importing into a project', () => {
  it('replaces in place, keeping the identity and the file name', async () => {
    const mine = await seed('Shop App');

    // What a collaborator sends back: same diagram, edited, and its revision
    // numbering has nothing to do with ours.
    const theirs: Diagram = {
      ...mine,
      name: 'Shop App v2',
      revision: 97,
      blocks: mine.blocks.slice(0, 1),
    };

    const outcome = await importDiagram(store, {
      incoming: theirs,
      action: 'replace',
      target: mine.slug,
    });

    expect(outcome.action).toBe('replace');
    expect(outcome.replaced).toBe('shop-app');
    expect(await store.listSlugs()).toEqual(['shop-app']);

    const saved = await store.readBySlug('shop-app');
    expect(saved.id).toBe(mine.id);
    expect(saved.slug).toBe('shop-app');
    expect(saved.name).toBe('Shop App v2');
    expect(saved.blocks).toHaveLength(1);
    // Ahead of our own last revision, and unaffected by theirs.
    expect(saved.revision).toBe(mine.revision + 1);
    expect(saved.createdAt).toBe(mine.createdAt);
  });

  it('adds a copy beside the original with a new identity', async () => {
    const mine = await seed('Shop App');
    const outcome = await importDiagram(store, { incoming: mine, action: 'copy' });

    expect((await store.listSlugs()).sort()).toEqual(['shop-app', 'shop-app-imported']);
    expect(outcome.diagram.id).not.toBe(mine.id);
    expect(outcome.diagram.name).toBe('Shop App (imported)');
    expect(outcome.diagram.blocks).toHaveLength(2);
    // The original is untouched.
    expect((await store.readBySlug('shop-app')).name).toBe('Shop App');
  });

  it('imports into an empty project under its own name', async () => {
    const source = await tempStore();
    const mine = await (async () => {
      const { diagram } = await source.store.create({ name: 'Shop App' });
      return diagram;
    })();

    const outcome = await importDiagram(store, { incoming: mine, action: 'copy' });
    expect(outcome.diagram.name).toBe('Shop App');
    expect(outcome.diagram.slug).toBe('shop-app');
    await source.cleanup();
  });

  it('survives a full round trip out to a file and back', async () => {
    const mine = await seed('Shop App');

    // Out to a file, edited by someone with no access to this project.
    const sent = parseTransfer(serializeDiagramFile(mine), 'shop-app.diagram.json').diagrams[0]!;
    const edited: Diagram = { ...sent, notes: 'reviewed by a colleague' };

    // Back in.
    const parsed = parseTransfer(serializeDiagramFile(edited), 'shop-app.diagram.json');
    const [candidate] = planImport(
      parsed.diagrams.map((diagram) => ({ diagram })),
      await store.list(),
    );
    expect(candidate?.action).toBe('replace');

    await importDiagram(store, {
      incoming: candidate!.incoming,
      action: 'replace',
      target: candidate!.existing!.slug,
    });

    const saved = await store.readBySlug('shop-app');
    expect(saved.notes).toBe('reviewed by a colleague');
    expect(saved.id).toBe(mine.id);
    expect(await store.listSlugs()).toEqual(['shop-app']);
  });

  it('refuses to replace without being told what to replace', async () => {
    const mine = await seed('Shop App');
    await expect(importDiagram(store, { incoming: mine, action: 'replace' })).rejects.toThrow(
      /needs the diagram to replace/,
    );
  });
});
