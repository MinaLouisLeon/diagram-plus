import chokidar, { type FSWatcher } from 'chokidar';
import { documentFromFilename, type DiagramStore, type DocumentKind } from '@diagram-plus/core';

/**
 * Watches `.diagrams/` so a change made outside the browser — by the MCP
 * server, by git, or by editing the JSON directly — reaches the open editor.
 *
 * Both documents in the directory are watched: the diagram and the screen
 * designs beside it. Claude writing a screen between two messages has to land
 * on the canvas the same way an edited block does, or the design tab is the
 * one place in the app where you have to reload.
 */

export interface WatcherEvents {
  onChanged: (slug: string, kind: DocumentKind) => void;
  onRemoved: (slug: string, kind: DocumentKind) => void;
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
    const found = documentFromFilename(file);
    if (found) events.onChanged(found.slug, found.kind);
  };

  watcher.on('add', changed);
  watcher.on('change', changed);
  watcher.on('unlink', (file) => {
    const found = documentFromFilename(file);
    if (found) events.onRemoved(found.slug, found.kind);
  });

  return watcher;
}
