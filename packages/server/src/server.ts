import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DesignStore,
  DiagramStore,
  NodeDiagramFs,
  summarize,
  type DesignDocument,
  type Diagram,
} from '@diagram-plus/core';
import { createApiRouter } from './api.js';
import { createStaticHandler, assetsExist } from './static.js';
import { watchDiagrams } from './watcher.js';
import { sendJson } from './http.js';

/**
 * The local editor server.
 *
 * It serves the editor, exposes the REST API, and keeps every open browser tab
 * in step with the file on disk — which is how a change Claude makes appears on
 * the canvas without a refresh.
 */

export const DEFAULT_PORT = 4517;

export interface ServerOptions {
  root: string;
  port?: number;
  host?: string;
  /** Directory of built editor assets. Defaults to the package's `public/`. */
  assetsDir?: string;
  /** Try the next port when one is taken. */
  autoPort?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  store: DiagramStore;
  close: () => Promise<void>;
}

type Broadcast =
  | { type: 'diagram:changed'; slug: string; revision: number; source: string; diagram: Diagram }
  | { type: 'diagram:deleted'; slug: string }
  | {
      type: 'design:changed';
      slug: string;
      revision: number;
      source: string;
      design: DesignDocument;
    }
  | { type: 'design:deleted'; slug: string }
  | { type: 'hello'; diagrams: ReturnType<typeof summarize>[]; root: string };

function defaultAssetsDir(): string {
  // dist/server.js -> ../public
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'public');
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  // One filesystem, two stores: the graph and the screen designs beside it
  // share a directory, a slug and a watcher, so they are never half-open.
  const fs = new NodeDiagramFs({ root: options.root });
  const store = new DiagramStore({ root: options.root });
  const designs = new DesignStore(fs);
  await store.ensureDir();

  const assetsDir = options.assetsDir ?? defaultAssetsDir();
  const hasAssets = await assetsExist(assetsDir);
  const serveStatic = createStaticHandler({ root: assetsDir });

  const sockets = new Set<WebSocket>();
  /** Last revision pushed per slug, so a save and its watcher echo send once. */
  const lastPushed = new Map<string, number>();
  const lastPushedDesign = new Map<string, number>();

  const broadcast = (message: Broadcast): void => {
    const text = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  };

  const pushDiagram = (diagram: Diagram, source: string): void => {
    if (lastPushed.get(diagram.slug) === diagram.revision && source !== 'api') return;
    lastPushed.set(diagram.slug, diagram.revision);
    broadcast({
      type: 'diagram:changed',
      slug: diagram.slug,
      revision: diagram.revision,
      source,
      diagram,
    });
  };

  const pushDesign = (design: DesignDocument, source: string): void => {
    if (lastPushedDesign.get(design.slug) === design.revision && source !== 'api') return;
    lastPushedDesign.set(design.slug, design.revision);
    broadcast({
      type: 'design:changed',
      slug: design.slug,
      revision: design.revision,
      source,
      design,
    });
  };

  const router = createApiRouter({
    store,
    designs,
    onChange: (diagram) => pushDiagram(diagram, 'api'),
    onDesignChange: (design) => pushDesign(design, 'api'),
    onDelete: (slug) => {
      lastPushed.delete(slug);
      lastPushedDesign.delete(slug);
      broadcast({ type: 'diagram:deleted', slug });
    },
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        res.end();
        return;
      }
      // The editor's dev server runs on a different port during development.
      res.setHeader('access-control-allow-origin', '*');

      if (await router.handle(req, res, url)) return;

      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: `No API route for ${req.method} ${url.pathname}` });
        return;
      }

      if (!hasAssets) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(placeholderPage(store.dir));
        return;
      }
      if (!(await serveStatic(url.pathname, res))) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      }
    })().catch((err) => {
      if (!res.writableEnded) sendJson(res, 500, { error: String(err) });
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    void store.list().then((diagrams) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'hello', diagrams, root: store.root } satisfies Broadcast));
      }
    });
  });

  const watcher = watchDiagrams(store, {
    onChanged: (slug, kind) => {
      if (kind === 'design') {
        void designs
          .read(slug)
          .then((design) => pushDesign(design, 'external'))
          .catch(() => undefined);
        return;
      }
      void store
        .readBySlug(slug)
        .then((diagram) => pushDiagram(diagram, 'external'))
        .catch(() => undefined);
    },
    onRemoved: (slug, kind) => {
      if (kind === 'design') {
        lastPushedDesign.delete(slug);
        broadcast({ type: 'design:deleted', slug });
        return;
      }
      lastPushed.delete(slug);
      broadcast({ type: 'diagram:deleted', slug });
    },
  });

  const host = options.host ?? '127.0.0.1';
  const port = await listen(server, options.port ?? DEFAULT_PORT, host, options.autoPort ?? true);

  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    port,
    store,
    close: async () => {
      await watcher.close();
      for (const socket of sockets) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(
  server: http.Server,
  port: number,
  host: string,
  autoPort: boolean,
  attempt = 0,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && autoPort && attempt < 20) {
        resolve(listen(server, port + 1, host, autoPort, attempt + 1));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function placeholderPage(directory: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>diagram-plus</title>
<style>
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; margin: 0; display: grid;
         place-items: center; min-height: 100vh; background: #0f172a; color: #e2e8f0; }
  main { max-width: 34rem; padding: 2rem; }
  code { background: #1e293b; padding: .15em .4em; border-radius: 4px; }
  a { color: #7dd3fc; }
</style>
<main>
  <h1>diagram-plus</h1>
  <p>The API is running and watching <code>${directory}</code>, but the editor has not been built yet.</p>
  <p>Build it with <code>npm run build</code> in the diagram-plus repository, then reload this page.</p>
  <p>The API is available under <a href="/api/diagrams">/api/diagrams</a>.</p>
</main>`;
}
