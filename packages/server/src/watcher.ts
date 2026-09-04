import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { DIAGRAM_EXT, type DiagramStore } from '@diagram-plus/core';

/**
 * Watches `.diagrams/` so a change made outside the browser — by the MCP
 * server, by git, or by editing the JSON directly — reaches the open editor.
 */

export interface WatcherEvents {
  onChanged: (slug: string) => void;
  onRemoved: (slug: string) => void;
}

function slugOf(file: string): string | null {
  const base = path.basename(file);
  if (!base.endsWith(DIAGRAM_EXT)) return null;
  return base.slice(0, -DIAGRAM_EXT.length);
}

export function watchDiagrams(store: DiagramStore, events: WatcherEvents): FSWatcher {
  const watcher = chokidar.watch(store.dir, {
    ignoreInitial: true,
    // Wait for writes to settle: the store writes to a temp file and renames,
    // but an editor saving JSON by hand may not be atomic.
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
    depth: 0,
  });

  const changed = (file: string) => {
    const slug = slugOf(file);
    if (slug) events.onChanged(slug);
  };

  watcher.on('add', changed);
  watcher.on('change', changed);
  watcher.on('unlink', (file) => {
    const slug = slugOf(file);
    if (slug) events.onRemoved(slug);
  });

  return watcher;
}
