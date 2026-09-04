import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  DiagramNotFoundError,
  DiagramStore,
  RevisionConflictError,
  addBlocks,
} from '@diagram-plus/core';
import { tempStore } from './helpers';

let store: DiagramStore;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ store, cleanup } = await tempStore());
});
afterEach(() => cleanup());

describe('the file store', () => {
  it('writes a diagram as readable JSON in .diagrams', async () => {
    const { diagram, file } = await store.create({ name: 'Shop App' });
    expect(diagram.slug).toBe('shop-app');
    expect(file).toContain('.diagrams/shop-app.diagram.json');

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { name: string; formatVersion: number };
    expect(onDisk.name).toBe('Shop App');
    expect(onDisk.formatVersion).toBe(1);
  });

  it('resolves a diagram by slug, id or name', async () => {
    const { diagram } = await store.create({ name: 'Recipe Box' });
    expect((await store.read('recipe-box')).id).toBe(diagram.id);
    expect((await store.read(diagram.id)).id).toBe(diagram.id);
    expect((await store.read('Recipe Box')).id).toBe(diagram.id);
    expect((await store.read('recipe box')).id).toBe(diagram.id);
  });

  it('reports a missing diagram by name', async () => {
    await expect(store.read('nope')).rejects.toBeInstanceOf(DiagramNotFoundError);
  });

  it('bumps the revision on every update', async () => {
    const { diagram } = await store.create({ name: 'Counter' });
    expect(diagram.revision).toBe(1);

    const first = await store.update(diagram.slug, (draft) => {
      draft.description = 'one';
    });
    expect(first.diagram.revision).toBe(2);

    const second = await store.update(diagram.slug, (draft) => {
      draft.description = 'two';
    });
    expect(second.diagram.revision).toBe(3);
  });

  it('refuses an update based on a stale revision', async () => {
    const { diagram } = await store.create({ name: 'Stale' });
    await store.update(diagram.slug, (draft) => {
      draft.description = 'moved on';
    });

    await expect(
      store.update(diagram.slug, () => undefined, { expectedRevision: diagram.revision }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('serialises concurrent updates instead of losing one', async () => {
    const { diagram } = await store.create({ name: 'Concurrent' });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.update(diagram.slug, (draft) => {
          addBlocks(draft, [{ type: 'note', name: `Note ${i}` }]);
        }),
      ),
    );
    const final = await store.read(diagram.slug);
    expect(final.blocks).toHaveLength(8);
    expect(final.revision).toBe(9);
  });

  it('renames the file when the diagram is renamed', async () => {
    const { diagram } = await store.create({ name: 'Old Name' });
    const renamed = await store.rename(diagram.slug, 'Brand New');
    expect(renamed.diagram.slug).toBe('brand-new');
    expect(await store.listSlugs()).toEqual(['brand-new']);
  });

  it('gives a colliding name a distinct slug', async () => {
    await store.create({ name: 'Duplicate' });
    const second = await store.create({ name: 'Duplicate' });
    expect(second.diagram.slug).toBe('duplicate-2');
  });

  it('lists diagrams newest first', async () => {
    await store.create({ name: 'First' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { diagram } = await store.create({ name: 'Second' });
    const list = await store.list();
    expect(list[0]?.slug).toBe(diagram.slug);
    expect(list).toHaveLength(2);
  });

  it('deletes a diagram file', async () => {
    const { diagram } = await store.create({ name: 'Temporary' });
    await store.delete(diagram.slug);
    expect(await store.listSlugs()).toEqual([]);
    expect(await store.exists(diagram.slug)).toBe(false);
  });

  it('reports an empty directory rather than failing', async () => {
    expect(await store.list()).toEqual([]);
  });
});
