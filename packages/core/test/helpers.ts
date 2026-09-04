import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiagramStore } from '@diagram-plus/core';

/** A store rooted in a throwaway directory, cleaned up by the caller. */
export async function tempStore(): Promise<{ store: DiagramStore; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diagram-plus-test-'));
  return {
    store: new DiagramStore({ root }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
