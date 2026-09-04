import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

/**
 * Serves the built editor. Any unknown path falls back to index.html so the
 * editor can own its own routing (`/d/<slug>`).
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticOptions {
  root: string;
}

export function createStaticHandler(options: StaticOptions) {
  const root = path.resolve(options.root);

  return async function serve(pathname: string, res: ServerResponse): Promise<boolean> {
    const relative = pathname.replace(/^\/+/, '');
    const candidate = path.resolve(root, relative);

    // Refuse anything that escapes the asset directory.
    const inside = candidate === root || candidate.startsWith(root + path.sep);
    const target = inside && relative ? candidate : path.join(root, 'index.html');

    let file = target;
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(root, 'index.html');
    }

    let body: Buffer;
    try {
      body = await fs.readFile(file);
    } catch {
      return false;
    }

    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
    return true;
  };
}

export async function assetsExist(root: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, 'index.html'));
    return true;
  } catch {
    return false;
  }
}
