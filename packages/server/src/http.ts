import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A very small router. The API has a dozen routes and no middleware needs, so
 * pulling in a framework would cost more than it saves.
 */

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: () => Promise<unknown>;
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Marks a handler result as already-formatted (raw text, custom headers). */
export class RawResponse {
  constructor(
    public readonly body: string,
    public readonly contentType = 'text/plain; charset=utf-8',
    public readonly status = 200,
  ) {}
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method,
      segments: pattern.split('/').filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler) {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler) {
    return this.add('POST', pattern, handler);
  }
  patch(pattern: string, handler: Handler) {
    return this.add('PATCH', pattern, handler);
  }
  put(pattern: string, handler: Handler) {
    return this.add('PUT', pattern, handler);
  }
  delete(pattern: string, handler: Handler) {
    return this.add('DELETE', pattern, handler);
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  /** Returns true when the request was handled by a route. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const found = this.match(req.method ?? 'GET', url.pathname);
    if (!found) return false;

    const ctx: RequestContext = {
      req,
      res,
      params: found.params,
      query: url.searchParams,
      body: () => readJsonBody(req),
    };

    try {
      const result = await found.route.handler(ctx);
      if (res.writableEnded) return true;
      if (result instanceof RawResponse) {
        res.writeHead(result.status, { 'content-type': result.contentType });
        res.end(result.body);
      } else if (result === undefined) {
        res.writeHead(204).end();
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, status, { error: message });
    }
    return true;
  }
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > 8 * 1024 * 1024) throw new HttpError(413, 'Request body too large.');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}
