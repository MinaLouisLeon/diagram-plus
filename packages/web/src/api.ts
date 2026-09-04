import type {
  BatchOperation,
  BlockTypeInfo,
  BlockCategory,
  Diagram,
  DiagramSummary,
  EdgeTypeInfo,
  ValidationResult,
} from '@diagram-plus/core/browser';

/** Thin REST client. Every response is JSON; errors carry the server message. */

export interface Catalog {
  blockTypes: BlockTypeInfo[];
  categories: { id: BlockCategory; label: string }[];
  edgeTypes: EdgeTypeInfo[];
  colors: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export const api = {
  catalog: () => request<Catalog>('/api/catalog'),

  listDiagrams: () => request<{ diagrams: DiagramSummary[] }>('/api/diagrams'),

  getDiagram: (slug: string) => request<{ diagram: Diagram }>(`/api/diagrams/${slug}`),

  createDiagram: (body: { name: string; description?: string; projectGoal?: string }) =>
    request<{ diagram: Diagram }>('/api/diagrams', { method: 'POST', body: JSON.stringify(body) }),

  deleteDiagram: (slug: string) =>
    request<{ deleted: string }>(`/api/diagrams/${slug}`, { method: 'DELETE' }),

  patchDiagram: (slug: string, body: Record<string, unknown>) =>
    request<{ diagram: Diagram }>(`/api/diagrams/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  replaceDiagram: (slug: string, diagram: Diagram) =>
    request<{ diagram: Diagram }>(`/api/diagrams/${slug}`, {
      method: 'PUT',
      body: JSON.stringify({ diagram }),
    }),

  batch: (slug: string, operations: BatchOperation[], layout = false) =>
    request<{ diagram: Diagram; result: { applied: number; errors: unknown[] } }>(
      `/api/diagrams/${slug}/batch`,
      { method: 'POST', body: JSON.stringify({ operations, layout }) },
    ),

  layout: (slug: string, direction: 'LR' | 'TB') =>
    request<{ diagram: Diagram }>(`/api/diagrams/${slug}/layout`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),

  spec: (slug: string) => request<{ markdown: string }>(`/api/diagrams/${slug}/spec`),

  validate: (slug: string) =>
    request<{ validation: ValidationResult }>(`/api/diagrams/${slug}/validate`),

  export: (slug: string, format: 'mermaid' | 'markdown' | 'json') =>
    request<{ format: string; content: string }>(`/api/diagrams/${slug}/export?format=${format}`),
};

/* ------------------------------------------------------------------ *
 * Live updates
 * ------------------------------------------------------------------ */

export type LiveMessage =
  | { type: 'hello'; diagrams: DiagramSummary[]; root: string }
  | { type: 'diagram:changed'; slug: string; revision: number; source: string; diagram: Diagram }
  | { type: 'diagram:deleted'; slug: string };

export interface LiveConnection {
  close: () => void;
}

/** Connects to the server's WebSocket, reconnecting with a simple backoff. */
export function connectLive(
  onMessage: (message: LiveMessage) => void,
  onStatus: (status: 'connecting' | 'open' | 'closed') => void,
): LiveConnection {
  let socket: WebSocket | null = null;
  let timer: number | undefined;
  let closed = false;
  let attempt = 0;

  const open = () => {
    if (closed) return;
    onStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.onopen = () => {
      attempt = 0;
      onStatus('open');
    };
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(String(event.data)) as LiveMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      onStatus('closed');
      if (closed) return;
      attempt += 1;
      timer = window.setTimeout(open, Math.min(1000 * attempt, 8000));
    };
    socket.onerror = () => socket?.close();
  };

  open();

  return {
    close: () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    },
  };
}
