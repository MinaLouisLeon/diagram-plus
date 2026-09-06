import { useSyncExternalStore } from 'react';

/**
 * The desktop shell.
 *
 * Everything in here is inert in a browser: `isDesktop()` is false, the store
 * stays empty and nothing imports Tauri at module scope. That keeps one bundle
 * serving both the `dgp` server and the packaged app.
 */

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

let ipc: Promise<{ invoke: Invoke; listen: Listen }> | null = null;

/**
 * Loaded on demand rather than imported at the top of the file: in a browser
 * build these modules are never fetched, and Vite keeps them in a chunk of
 * their own.
 */
function tauri(): Promise<{ invoke: Invoke; listen: Listen }> {
  ipc ??= Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]).then(
    ([core, event]) => ({
      invoke: core.invoke as Invoke,
      listen: event.listen as unknown as Listen,
    }),
  );
  return ipc;
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await tauri();
  return call<T>(command, args);
}

export async function listen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const { listen: on } = await tauri();
  return on(event, (e) => handler(e.payload));
}

/* ------------------------------------------------------------------ *
 * The open project
 * ------------------------------------------------------------------ */

export interface RecentProject {
  path: string;
  name: string;
  /** ISO timestamp of the last time it was opened. */
  openedAt: string;
  /** False once the folder has been moved or deleted. */
  exists: boolean;
}

export interface ProjectState {
  /** Project root, or null when no folder has been chosen yet. */
  root: string | null;
  /** The `.diagrams` directory inside it. */
  dir: string | null;
  /** Native path separator, so the UI can build display paths. */
  sep: string;
  recent: RecentProject[];
}

const EMPTY: ProjectState = { root: null, dir: null, sep: '/', recent: [] };

class ProjectStore {
  private state: ProjectState = EMPTY;
  private listeners = new Set<() => void>();
  private ready = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ProjectState => this.state;

  /** True once the first `project_state` call has come back. */
  isReady = (): boolean => this.ready;

  private set(state: ProjectState): void {
    this.state = state;
    this.ready = true;
    for (const listener of this.listeners) listener();
  }

  async init(): Promise<ProjectState> {
    if (!isDesktop()) {
      this.ready = true;
      return this.state;
    }
    const state = await invoke<ProjectState>('project_state');
    this.set(state);
    void listen('project-changed', (payload) => this.set(payload as ProjectState));
    return state;
  }

  /** Native folder picker. Resolves to the unchanged state if cancelled. */
  async pick(): Promise<ProjectState> {
    const state = await invoke<ProjectState>('project_pick');
    this.set(state);
    return state;
  }

  async open(path: string): Promise<ProjectState> {
    const state = await invoke<ProjectState>('project_open', { path });
    this.set(state);
    return state;
  }

  async forget(path: string): Promise<void> {
    this.set(await invoke<ProjectState>('project_forget', { path }));
  }

  async revealDiagramsFolder(): Promise<void> {
    if (this.state.dir) await invoke('open_path', { path: this.state.dir });
  }
}

export const project = new ProjectStore();

export function useProject(): ProjectState {
  return useSyncExternalStore(project.subscribe, project.getState, project.getState);
}

/* ------------------------------------------------------------------ *
 * MCP registration
 * ------------------------------------------------------------------ */

export type McpScope = 'local' | 'global';

export interface McpClient {
  id: string;
  label: string;
  kind: 'terminal' | 'desktop';
  detected: boolean;
  /** Config file this client would get for the chosen scope, if it has one. */
  target: string | null;
  /** Whether diagram-plus is already registered there. */
  installed: boolean;
  /** What to do once the write has happened. */
  after: string;
}

export interface McpStatus {
  /** Absolute path of the bundled MCP server entry point. */
  serverEntry: string;
  /** The `node` binary found on PATH, or null. */
  nodePath: string | null;
  nodeVersion: string | null;
  clients: McpClient[];
}

export interface McpResult {
  clientId: string;
  label: string;
  file: string;
  action: 'added' | 'updated' | 'unchanged' | 'removed' | 'absent' | 'skipped' | 'failed';
  detail: string | null;
}

export interface McpReport {
  results: McpResult[];
  backups: string[];
}

export const mcp = {
  status: (scope: McpScope) => invoke<McpStatus>('mcp_status', { scope }),
  install: (scope: McpScope, clientIds: string[]) =>
    invoke<McpReport>('mcp_apply', { scope, clientIds, remove: false }),
  uninstall: (scope: McpScope, clientIds: string[]) =>
    invoke<McpReport>('mcp_apply', { scope, clientIds, remove: true }),
};
