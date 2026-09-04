import { useSyncExternalStore } from 'react';
import {
  applyBatch,
  validateDiagram,
  type BatchOperation,
  type Diagram,
  type DiagramSummary,
  type ValidationResult,
} from '@diagram-plus/core/browser';
import { ApiError, api, connectLive, type Catalog, type LiveMessage } from './api';

/**
 * Editor state.
 *
 * Edits are expressed as the same batch operations the MCP tools use, applied
 * optimistically to the local copy and then flushed to the server. Keeping the
 * wire format operation-based (rather than sending the whole document) is what
 * lets a drag on the canvas and an edit from Claude land in the same file
 * without one clobbering the other.
 */

export type Panel = 'validation' | 'spec' | 'progress' | null;

export interface EditorState {
  connection: 'connecting' | 'open' | 'closed';
  loading: boolean;
  catalog: Catalog | null;
  diagrams: DiagramSummary[];
  current: Diagram | null;
  validation: ValidationResult | null;
  selectedBlocks: string[];
  selectedEdges: string[];
  panel: Panel;
  saving: boolean;
  error: string | null;
  /** Set when a change arrives that this browser did not make. */
  externalEdit: { at: number; revision: number } | null;
  canUndo: boolean;
  canRedo: boolean;
}

const FLUSH_DELAY = 220;
const HISTORY_LIMIT = 60;

class EditorStore {
  private state: EditorState = {
    connection: 'connecting',
    loading: true,
    catalog: null,
    diagrams: [],
    current: null,
    validation: null,
    selectedBlocks: [],
    selectedEdges: [],
    panel: null,
    saving: false,
    error: null,
    externalEdit: null,
    canUndo: false,
    canRedo: false,
  };

  private listeners = new Set<() => void>();
  private pending: BatchOperation[] = [];
  private flushTimer: number | undefined;
  private inFlight = 0;
  private undoStack: Diagram[] = [];
  private redoStack: Diagram[] = [];
  private live: { close: () => void } | null = null;
  private viewportTimer: number | undefined;

  /* ---- subscription -------------------------------------------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorState => this.state;

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setDiagram(diagram: Diagram | null, patch: Partial<EditorState> = {}): void {
    this.set({
      current: diagram,
      validation: diagram ? validateDiagram(diagram) : null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      ...patch,
    });
  }

  /* ---- lifecycle ----------------------------------------------------- */

  async init(): Promise<void> {
    try {
      const [catalog, list] = await Promise.all([api.catalog(), api.listDiagrams()]);
      this.set({ catalog, diagrams: list.diagrams, loading: false });
    } catch (err) {
      this.set({ loading: false, error: describe(err) });
    }
    this.live = connectLive(
      (message) => this.onLive(message),
      (connection) => this.set({ connection }),
    );
  }

  dispose(): void {
    this.live?.close();
  }

  private onLive(message: LiveMessage): void {
    if (message.type === 'hello') {
      this.set({ diagrams: message.diagrams });
      return;
    }
    if (message.type === 'diagram:deleted') {
      this.set({
        diagrams: this.state.diagrams.filter((d) => d.slug !== message.slug),
        ...(this.state.current?.slug === message.slug ? { current: null } : {}),
      });
      return;
    }

    void api.listDiagrams().then((list) => this.set({ diagrams: list.diagrams }));

    const current = this.state.current;
    if (!current || current.slug !== message.slug) return;
    if (message.revision <= current.revision) return;
    // Don't stomp on edits the user is in the middle of making.
    if (this.pending.length || this.inFlight > 0) return;

    this.setDiagram(message.diagram, {
      externalEdit:
        message.source === 'external' ? { at: Date.now(), revision: message.revision } : null,
    });
  }

  /* ---- diagrams ------------------------------------------------------- */

  async open(slug: string): Promise<void> {
    if (this.state.current?.slug === slug) return;
    await this.flush();
    this.undoStack = [];
    this.redoStack = [];
    this.set({ loading: true, selectedBlocks: [], selectedEdges: [] });
    try {
      const { diagram } = await api.getDiagram(slug);
      this.setDiagram(diagram, { loading: false, error: null, externalEdit: null });
    } catch (err) {
      this.set({ loading: false, error: describe(err) });
    }
  }

  async createDiagram(name: string, projectGoal?: string): Promise<Diagram | null> {
    try {
      const { diagram } = await api.createDiagram({ name, projectGoal });
      const list = await api.listDiagrams();
      this.undoStack = [];
      this.redoStack = [];
      this.setDiagram(diagram, { diagrams: list.diagrams, error: null });
      return diagram;
    } catch (err) {
      this.set({ error: describe(err) });
      return null;
    }
  }

  async deleteDiagram(slug: string): Promise<void> {
    try {
      await api.deleteDiagram(slug);
      const list = await api.listDiagrams();
      this.set({
        diagrams: list.diagrams,
        ...(this.state.current?.slug === slug ? { current: null, validation: null } : {}),
      });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  async patchMeta(patch: Record<string, unknown>): Promise<void> {
    const slug = this.state.current?.slug;
    if (!slug) return;
    await this.flush();
    try {
      const { diagram } = await api.patchDiagram(slug, patch);
      const list = await api.listDiagrams();
      this.setDiagram(diagram, { diagrams: list.diagrams, error: null });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /**
   * Remember where the user left the canvas. Debounced and fire-and-forget:
   * losing a viewport update matters far less than an extra write.
   */
  saveViewport(canvas: { x: number; y: number; zoom: number }): void {
    const slug = this.state.current?.slug;
    if (!slug) return;
    window.clearTimeout(this.viewportTimer);
    this.viewportTimer = window.setTimeout(() => {
      void api.patchDiagram(slug, { canvas }).catch(() => undefined);
    }, 600);
  }

  async runLayout(direction: 'LR' | 'TB' = 'LR'): Promise<void> {
    const slug = this.state.current?.slug;
    if (!slug) return;
    await this.flush();
    this.pushHistory();
    try {
      const { diagram } = await api.layout(slug, direction);
      this.setDiagram(diagram, { error: null });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /* ---- editing --------------------------------------------------------- */

  /**
   * Apply operations locally and queue them for the server.
   * `history: false` is for high-frequency changes (a drag in progress) that
   * should not each become an undo step.
   */
  apply(operations: BatchOperation[], options: { history?: boolean } = {}): void {
    const current = this.state.current;
    if (!current || operations.length === 0) return;

    if (options.history !== false) this.pushHistory();

    const draft: Diagram = structuredClone(current);
    const result = applyBatch(draft, operations);
    if (result.errors.length) {
      this.set({ error: result.errors[0]?.message ?? 'Change could not be applied.' });
    }
    this.setDiagram(draft);

    this.pending.push(...operations);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.flush(), FLUSH_DELAY);
  }

  /** Send everything queued. Safe to call at any time. */
  async flush(): Promise<void> {
    window.clearTimeout(this.flushTimer);
    const slug = this.state.current?.slug;
    if (!slug || this.pending.length === 0) return;

    const operations = this.pending;
    this.pending = [];
    this.inFlight += 1;
    this.set({ saving: true });

    try {
      const { diagram } = await api.batch(slug, operations);
      // Only trust the server's copy if nothing else is queued behind us.
      if (this.pending.length === 0 && this.inFlight === 1 && this.state.current?.slug === slug) {
        this.setDiagram(diagram, { error: null });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await this.reload();
        this.set({ error: 'The diagram changed elsewhere, so it was reloaded.' });
      } else {
        this.set({ error: describe(err) });
      }
    } finally {
      this.inFlight -= 1;
      this.set({ saving: this.inFlight > 0 });
    }
  }

  async reload(): Promise<void> {
    const slug = this.state.current?.slug;
    if (!slug) return;
    try {
      const { diagram } = await api.getDiagram(slug);
      this.setDiagram(diagram);
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /* ---- history --------------------------------------------------------- */

  private pushHistory(): void {
    const current = this.state.current;
    if (!current) return;
    this.undoStack.push(structuredClone(current));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo(): Promise<void> {
    const previous = this.undoStack.pop();
    const current = this.state.current;
    if (!previous || !current) return;
    this.redoStack.push(structuredClone(current));
    await this.restore(previous);
  }

  async redo(): Promise<void> {
    const next = this.redoStack.pop();
    const current = this.state.current;
    if (!next || !current) return;
    this.undoStack.push(structuredClone(current));
    await this.restore(next);
  }

  private async restore(snapshot: Diagram): Promise<void> {
    await this.flush();
    this.setDiagram(snapshot, { saving: true });
    try {
      const { diagram } = await api.replaceDiagram(snapshot.slug, snapshot);
      this.setDiagram(diagram, { saving: false, error: null });
    } catch (err) {
      this.set({ saving: false, error: describe(err) });
    }
  }

  /* ---- ui state --------------------------------------------------------- */

  select(blocks: string[], edges: string[] = []): void {
    this.set({ selectedBlocks: blocks, selectedEdges: edges });
  }

  setPanel(panel: Panel): void {
    this.set({ panel: this.state.panel === panel ? null : panel });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  dismissExternalEdit(): void {
    this.set({ externalEdit: null });
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const store = new EditorStore();

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useEditorState(): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
