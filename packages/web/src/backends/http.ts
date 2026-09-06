import type { BatchOperation, Diagram } from '@diagram-plus/core/browser';
import {
  ApiError,
  type Api,
  type Backend,
  type Catalog,
  type LiveConnection,
  type LiveMessage,
  type LiveStatus,
} from './types';

/**
 * The browser backend: a thin REST client for the local `dgp` server, plus its
 * WebSocket. Every response is JSON; errors carry the server message.
 */

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

const api: Api = {
  catalog: () => request<Catalog>('/api/catalog'),

  listDiagrams: () => request('/api/diagrams'),

  getDiagram: (slug) => request(`/api/diagrams/${slug}`),

  createDiagram: (body) =>
    request('/api/diagrams', { method: 'POST', body: JSON.stringify(body) }),

  deleteDiagram: (slug) => request(`/api/diagrams/${slug}`, { method: 'DELETE' }),

  patchDiagram: (slug, body) =>
    request(`/api/diagrams/${slug}`, { method: 'PATCH', body: JSON.stringify(body) }),

  replaceDiagram: (slug, diagram: Diagram) =>
    request(`/api/diagrams/${slug}`, { method: 'PUT', body: JSON.stringify({ diagram }) }),

  batch: (slug, operations: BatchOperation[], layout = false) =>
    request(`/api/diagrams/${slug}/batch`, {
      method: 'POST',
      body: JSON.stringify({ operations, layout }),
    }),

  layout: (slug, direction) =>
    request(`/api/diagrams/${slug}/layout`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),

  spec: (slug) => request(`/api/diagrams/${slug}/spec`),

  validate: (slug) => request(`/api/diagrams/${slug}/validate`),

  export: (slug, format) => request(`/api/diagrams/${slug}/export?format=${format}`),
};

/** Connects to the server's WebSocket, reconnecting with a simple backoff. */
function connectLive(
  onMessage: (message: LiveMessage) => void,
  onStatus: (status: LiveStatus) => void,
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

export const httpBackend: Backend = { api, connectLive };
