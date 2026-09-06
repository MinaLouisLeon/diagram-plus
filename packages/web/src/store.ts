import { useSyncExternalStore } from 'react';
import {
  applyBatch,
  autoLayout,
  validateDiagram,
  type BatchOperation,
  type Diagram,
  type DiagramStatus,
  type DiagramSummary,
  type ValidationResult,
} from '@diagram-plus/core/browser';
import { api, connectLive, type Catalog, type LiveMessage } from './api';
import { unsavedPrompt, type UnsavedReason } from './unsaved';

/**
 * Editor state.
 *
 * Edits are applied to a local copy of the diagram and go no further until the
 * user saves. Nothing on the canvas touches the file on disk, so an experiment
 * can be abandoned by simply not saving it — and the price is that anything
 * which would drop those edits (closing the window, opening another diagram)
 * has to ask first.
 *
 * Saving writes the whole document. While unsaved edits exist the local copy is
 * what the user is looking at, so changes arriving from elsewhere are held back
 * rather than merged underneath them; the save then wins.
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
  /** True while a save is in flight. */
  saving: boolean;
  /** True when the local copy has edits that are not on disk. */
  dirty: boolean;
  error: string | null;
  /** Set when a change arrives that this browser did not make. */
  externalEdit: { at: number; revision: number; applied: boolean } | null;
  canUndo: boolean;
  canRedo: boolean;
}

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
    dirty: false,
    error: null,
    externalEdit: null,
    canUndo: false,
    canRedo: false,
  };

  private listeners = new Set<() => void>();
  private undoStack: Diagram[] = [];
  private redoStack: Diagram[] = [];
  private live: { close: () => void } | null = null;
  private viewportTimer: number | undefined;
  /** Bumped by every edit, so a save can tell whether it was overtaken. */
  private editSeq = 0;

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

  /** Replace the local copy with an edited one and mark it unsaved. */
  private edit(diagram: Diagram): void {
    this.editSeq += 1;
    this.setDiagram(diagram, { dirty: true });
  }

  /* ---- lifecycle ----------------------------------------------------- */

  async init(): Promise<void> {
    // Called again whenever the desktop app changes project, so nothing from
    // the last one is left open. Synchronous, ahead of the first await, so a
    // diagram opened from the URL right after this is not swept away with it.
    this.undoStack = [];
    this.redoStack = [];
    this.set({
      current: null,
      validation: null,
      dirty: false,
      selectedBlocks: [],
      selectedEdges: [],
      externalEdit: null,
    });

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
        ...(this.state.current?.slug === message.slug
          ? { current: null, validation: null, dirty: false }
          : {}),
      });
      return;
    }

    void api.listDiagrams().then((list) => this.set({ diagrams: list.diagrams }));

    const current = this.state.current;
    if (!current || current.slug !== message.slug) return;
    if (message.revision <= current.revision) return;

    // Unsaved work outranks the file: keep what the user is looking at, and say
    // that the file moved on so the save is not a surprise.
    if (this.state.dirty) {
      if (message.source === 'external') {
        this.set({ externalEdit: { at: Date.now(), revision: message.revision, applied: false } });
      }
      return;
    }

    this.setDiagram(message.diagram, {
      externalEdit:
        message.source === 'external'
          ? { at: Date.now(), revision: message.revision, applied: true }
          : null,
    });
  }

  /* ---- diagrams ------------------------------------------------------- */

  async open(slug: string): Promise<void> {
    if (this.state.current?.slug === slug) return;
    if (!(await this.confirmDiscard('switch'))) return;
    this.undoStack = [];
    this.redoStack = [];
    this.set({ loading: true, selectedBlocks: [], selectedEdges: [] });
    try {
      const { diagram } = await api.getDiagram(slug);
      this.setDiagram(diagram, { loading: false, error: null, dirty: false, externalEdit: null });
    } catch (err) {
      this.set({ loading: false, error: describe(err) });
    }
  }

  async createDiagram(name: string, projectGoal?: string): Promise<Diagram | null> {
    if (!(await this.confirmDiscard('switch'))) return null;
    try {
      const { diagram } = await api.createDiagram({ name, projectGoal });
      const list = await api.listDiagrams();
      this.undoStack = [];
      this.redoStack = [];
      this.setDiagram(diagram, {
        diagrams: list.diagrams,
        error: null,
        dirty: false,
        externalEdit: null,
      });
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
        ...(this.state.current?.slug === slug
          ? { current: null, validation: null, dirty: false, externalEdit: null }
          : {}),
      });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /**
   * Change the diagram's own fields — goal, description, notes, stack, status.
   * Local like every other edit, so it takes a save to reach the file.
   */
  patchMeta(patch: Record<string, unknown>): void {
    const current = this.state.current;
    if (!current) return;

    const next: Diagram = structuredClone(current);
    if (typeof patch['name'] === 'string' && patch['name'].trim()) next.name = patch['name'].trim();
    if (typeof patch['description'] === 'string') next.description = patch['description'];
    if (typeof patch['projectGoal'] === 'string') next.projectGoal = patch['projectGoal'];
    if (typeof patch['notes'] === 'string') next.notes = patch['notes'];
    if (typeof patch['status'] === 'string') {
      if (!['draft', 'ready', 'implemented'].includes(patch['status'])) {
        this.set({ error: `Unknown status "${patch['status']}".` });
        return;
      }
      next.status = patch['status'] as DiagramStatus;
    }
    if (patch['techStack'] && typeof patch['techStack'] === 'object') {
      next.techStack = { ...next.techStack, ...(patch['techStack'] as object) };
    }
    if (patch['canvas'] && typeof patch['canvas'] === 'object') {
      next.canvas = { ...next.canvas, ...(patch['canvas'] as object) };
    }

    // Committing a text field on blur is common and usually changes nothing.
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.pushHistory();
    this.edit(next);
  }

  /**
   * Remember where the user left the canvas. Where the diagram sits on screen
   * is not an edit of it, so this is written straight through, debounced and
   * fire-and-forget: losing a viewport update matters far less than an extra
   * write, and panning must not be what lights the Save button up.
   */
  saveViewport(canvas: { x: number; y: number; zoom: number }): void {
    const current = this.state.current;
    if (!current) return;
    const slug = current.slug;

    // Keep the local copy in step so a later save does not put the old
    // viewport back.
    this.set({ current: { ...current, canvas: { ...current.canvas, ...canvas } } });

    window.clearTimeout(this.viewportTimer);
    this.viewportTimer = window.setTimeout(() => {
      void api.patchDiagram(slug, { canvas }).catch(() => undefined);
    }, 600);
  }

  /** Arrange the blocks by dependency. Local, like any other edit. */
  runLayout(direction: 'LR' | 'TB' = 'LR'): void {
    const current = this.state.current;
    if (!current) return;
    this.pushHistory();
    const next: Diagram = structuredClone(current);
    autoLayout(next, { direction });
    this.edit(next);
  }

  /* ---- editing --------------------------------------------------------- */

  /**
   * Apply operations to the local copy.
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
    this.edit(draft);
  }

  /* ---- saving ---------------------------------------------------------- */

  /** Write the local copy to disk. */
  async save(): Promise<void> {
    const current = this.state.current;
    if (!current || !this.state.dirty || this.state.saving) return;

    const seq = this.editSeq;
    this.set({ saving: true });
    try {
      const { diagram } = await api.replaceDiagram(current.slug, current);
      const list = await api.listDiagrams();
      // Anything edited while the write was in flight is still unsaved, and the
      // local copy stays as it is — the server's reply is already behind it.
      const editedSince = this.editSeq !== seq;
      this.setDiagram(editedSince ? this.state.current : diagram, {
        diagrams: list.diagrams,
        saving: false,
        dirty: editedSince,
        error: null,
        externalEdit: null,
      });
    } catch (err) {
      this.set({ saving: false, error: describe(err) });
    }
  }

  /**
   * Ask before doing something that would lose unsaved edits.
   * Returns false when the user decided not to go ahead after all.
   */
  async confirmDiscard(reason: UnsavedReason): Promise<boolean> {
    if (!this.state.dirty) return true;
    const choice = await unsavedPrompt.ask(reason);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      await this.save();
      // A save that failed is not a reason to carry on and lose the work.
      return !this.state.dirty;
    }
    this.set({ dirty: false });
    return true;
  }

  async reload(): Promise<void> {
    const slug = this.state.current?.slug;
    if (!slug) return;
    try {
      const { diagram } = await api.getDiagram(slug);
      this.setDiagram(diagram, { dirty: false, externalEdit: null, error: null });
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

  undo(): void {
    const previous = this.undoStack.pop();
    const current = this.state.current;
    if (!previous || !current) return;
    this.redoStack.push(structuredClone(current));
    this.edit(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    const current = this.state.current;
    if (!next || !current) return;
    this.undoStack.push(structuredClone(current));
    this.edit(next);
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
