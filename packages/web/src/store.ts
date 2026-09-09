import { useSyncExternalStore } from 'react';
import {
  applyBatch,
  applyClientView,
  autoLayout,
  buildProjectTree,
  bundleFileName,
  createBundle,
  deriveClientView,
  designProgress as computeDesignProgress,
  diagramFileName,
  diffClientView,
  diffDesign,
  editClientView,
  editDesign,
  factsOf,
  findHtml,
  parseHtml,
  layoutDesign,
  layoutClientView,
  parseTransfer,
  planImport,
  reconcileClientView,
  serializeBundle,
  serializeDiagramFile,
  treeToMarkdown,
  treeToText,
  validateDiagram,
  type BatchOperation,
  type BatchResult,
  type ClientView,
  type ClientViewDiff,
  type ClientViewOperation,
  type DesignDiff,
  type DesignDocument,
  type ElementFacts,
  type DesignOperation,
  type DesignProgress,
  type Diagram,
  type ScreenDesign,
  type DiagramStatus,
  type DiagramSummary,
  type ImportCandidate,
  type TreeFilter,
  type TreeOptions,
  type ValidationResult,
} from '@diagram-plus/core/browser';
import { api, connectLive, type Catalog, type LiveMessage } from './api';
import { pickFiles, saveFile } from './transfer';
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

/**
 * Which document is filling the workspace: the technical diagram, the
 * plain-language view a client is shown, or the screen designs.
 */
export type EditorView = 'diagram' | 'client' | 'design';

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
  /** Which of the two documents fills the workspace. */
  view: EditorView;
  /** How the client view is built. Mirrored into the view when it is saved. */
  treeOptions: TreeOptions;
  /**
   * A client view derived for a diagram that has never had one saved. Held
   * here rather than in the diagram so that opening the tab to look does not
   * mark the file as changed; the first edit commits it.
   */
  clientDraft: ClientView | null;
  /** Boxes selected in the client view. */
  selectedClient: string[];

  /**
   * The screen designs.
   *
   * They live in their own file, so unlike the client view they are fetched
   * rather than read off the diagram — null until the Design tab is opened.
   * What comes back for a project that has never been designed is derived
   * from the diagram and not yet written; `designSaved` says which it is.
   */
  design: DesignDocument | null;
  designChanges: DesignDiff | null;
  designProgress: DesignProgress | null;
  designSaved: boolean;
  designLoading: boolean;
  /** Unsaved design edits. Tracked apart from the diagram's own `dirty`. */
  designDirty: boolean;
  designSaving: boolean;
  /** The artboard and the element being worked on. */
  selectedScreen: string | null;
  selectedElement: string | null;
  /** Which side panel the design tab is showing. */
  designPanel: 'layers' | 'tokens';
  /** True while the client view is filling the window for a review. */
  presenting: boolean;
  /** True while a save is in flight. */
  saving: boolean;
  /** True when the local copy has edits that are not on disk. */
  dirty: boolean;
  error: string | null;
  /** Set when a change arrives that this browser did not make. */
  externalEdit: { at: number; revision: number; applied: boolean } | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Project root, as the backend reports it. Names an exported bundle. */
  root: string;
  /**
   * Files the user picked to import, paired with what they collide with.
   * Non-null while the import dialog is up; nothing is written until it is
   * confirmed.
   */
  importPlan: { candidates: ImportCandidate[]; warning: string | null } | null;
  /** Said and gone — an import or export that finished. */
  notice: string | null;
}

const HISTORY_LIMIT = 60;

/** Everything design-related, cleared. Used whenever the open diagram changes. */
const BLANK_DESIGN = {
  design: null,
  designChanges: null,
  designProgress: null,
  designSaved: false,
  designDirty: false,
  designLoading: false,
  selectedScreen: null,
  selectedElement: null,
} satisfies Partial<EditorState>;

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
    view: 'diagram',
    treeOptions: {},
    clientDraft: null,
    selectedClient: [],
    design: null,
    designChanges: null,
    designProgress: null,
    designSaved: false,
    designLoading: false,
    designDirty: false,
    designSaving: false,
    selectedScreen: null,
    selectedElement: null,
    designPanel: 'layers',
    presenting: false,
    saving: false,
    dirty: false,
    error: null,
    externalEdit: null,
    canUndo: false,
    canRedo: false,
    root: '',
    importPlan: null,
    notice: null,
  };

  private listeners = new Set<() => void>();
  private undoStack: Diagram[] = [];
  private redoStack: Diagram[] = [];
  /**
   * The designs get their own history.
   *
   * Undo applies to whatever you are looking at, which is both the obvious
   * reading of Ctrl+Z and the only one that does not make an accidental
   * keystroke in one document undo an hour's work in the other.
   */
  private designUndoStack: DesignDocument[] = [];
  private designRedoStack: DesignDocument[] = [];
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
      ...this.historyFlags(),
      ...patch,
    });
  }

  /** Whether undo and redo are available *for the document on screen*. */
  private historyFlags(view: EditorView = this.state.view): Partial<EditorState> {
    return view === 'design'
      ? { canUndo: this.designUndoStack.length > 0, canRedo: this.designRedoStack.length > 0 }
      : { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  /**
   * Replace the local copy of the designs, keeping everything derived from
   * them in step — the diff against the diagram, the progress counts, and
   * whether a selected element still exists.
   */
  private setDesign(design: DesignDocument | null, patch: Partial<EditorState> = {}): void {
    const current = this.state.current;
    const screens = design?.screens ?? [];
    const selectedScreen =
      this.state.selectedScreen && screens.some((s) => s.id === this.state.selectedScreen)
        ? this.state.selectedScreen
        : (screens[0]?.id ?? null);
    const screen = screens.find((s) => s.id === selectedScreen);
    const selectedElement =
      screen && this.state.selectedElement && findHtml(parseHtml(screen.html), this.state.selectedElement)
        ? this.state.selectedElement
        : null;

    this.set({
      design,
      designChanges: design && current ? diffDesign(current, design) : null,
      designProgress: design && current ? computeDesignProgress(current, design) : null,
      selectedScreen,
      selectedElement,
      ...this.historyFlags(),
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
      selectedClient: [],
      clientDraft: null,
      externalEdit: null,
      ...BLANK_DESIGN,
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
      this.set({ diagrams: message.diagrams, root: message.root });
      return;
    }
    if (message.type === 'design:deleted') {
      if (this.state.current?.slug === message.slug) this.set({ ...BLANK_DESIGN });
      return;
    }
    if (message.type === 'design:changed') {
      const current = this.state.current;
      if (!current || current.slug !== message.slug) return;
      // Unsaved design work outranks the file, exactly as it does for the
      // diagram: the user keeps what is on screen and is told the file moved.
      if (this.state.designDirty) {
        if (message.source === 'external') {
          this.set({
            externalEdit: { at: Date.now(), revision: message.revision, applied: false },
          });
        }
        return;
      }
      if (this.state.design && message.revision <= this.state.design.revision) return;
      this.setDesign(message.design, { designSaved: true, designDirty: false });
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
    this.designUndoStack = [];
    this.designRedoStack = [];
    this.set({
      loading: true,
      selectedBlocks: [],
      selectedEdges: [],
      selectedClient: [],
      clientDraft: null,
      ...BLANK_DESIGN,
    });
    try {
      const { diagram } = await api.getDiagram(slug);
      this.setDiagram(diagram, {
        loading: false,
        error: null,
        dirty: false,
        externalEdit: null,
        // A saved client view remembers how it was built; the controls should
        // open showing that, not the last diagram's settings.
        treeOptions: diagram.clientView?.options ?? {},
      });
      if (this.state.view === 'client') this.primeClientView();
      if (this.state.view === 'design') void this.loadDesign();
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
  apply(operations: BatchOperation[], options: { history?: boolean } = {}): BatchResult | null {
    const current = this.state.current;
    if (!current || operations.length === 0) return null;

    if (options.history !== false) this.pushHistory();

    const draft: Diagram = structuredClone(current);
    const result = applyBatch(draft, operations);
    if (result.errors.length) {
      this.set({ error: result.errors[0]?.message ?? 'Change could not be applied.' });
    }
    this.edit(draft);
    return result;
  }

  /* ---- saving ---------------------------------------------------------- */

  /**
   * Write the local copies to disk — the diagram, the designs, or both.
   *
   * One Save button covers two files. They are written separately because they
   * are separate documents with separate revisions, but a user who has moved a
   * block and moved a button means one thing by "save".
   */
  async save(): Promise<void> {
    await Promise.all([this.saveDiagram(), this.saveDesign()]);
  }

  private async saveDiagram(): Promise<void> {
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
    if (!this.state.dirty && !this.state.designDirty) return true;
    const choice = await unsavedPrompt.ask(reason);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      await this.save();
      // A save that failed is not a reason to carry on and lose the work.
      return !this.state.dirty && !this.state.designDirty;
    }
    this.set({ dirty: false, designDirty: false });
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

  /* ---- import and export ----------------------------------------------- */

  /**
   * Write the open diagram out as a file the user can send to someone who does
   * not have this repository.
   *
   * It exports the copy on screen, unsaved edits and all: that is the diagram
   * the user is looking at and means by "this one", and being asked to save
   * first before you can send a draft to a colleague would be a strange rule.
   */
  async exportCurrent(): Promise<void> {
    const current = this.state.current;
    if (!current) return;
    try {
      const path = await saveFile(diagramFileName(current), serializeDiagramFile(current));
      if (path) this.set({ notice: `Exported “${current.name}” to ${path}.`, error: null });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /** Every diagram in the project, in one file. */
  async exportAll(): Promise<void> {
    const summaries = this.state.diagrams;
    if (!summaries.length) {
      this.set({ error: 'There are no diagrams in this project to export.' });
      return;
    }

    try {
      const current = this.state.current;
      const diagrams = await Promise.all(
        summaries.map(async (summary) =>
          // The open one comes from the canvas rather than the file, so a
          // bundle matches what "export this diagram" would have given.
          current?.slug === summary.slug
            ? current
            : (await api.getDiagram(summary.slug)).diagram,
        ),
      );
      const source = projectName(this.state.root);
      const path = await saveFile(
        bundleFileName(source),
        serializeBundle(createBundle(diagrams, { source })),
      );
      if (path) {
        this.set({
          notice: `Exported ${diagrams.length} diagram${diagrams.length === 1 ? '' : 's'} to ${path}.`,
          error: null,
        });
      }
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /**
   * Read the files the user picked and work out what each would land on.
   *
   * Nothing is written here. The dialog this opens is the point of the whole
   * feature: an import usually means overwriting a diagram, and the user
   * should see what they are about to overwrite before it happens.
   */
  async beginImport(): Promise<void> {
    let files;
    try {
      files = await pickFiles();
    } catch (err) {
      this.set({ error: describe(err) });
      return;
    }
    if (!files.length) return;

    const incoming: { diagram: Diagram; file: string }[] = [];
    let newer = false;
    try {
      for (const file of files) {
        const parsed = parseTransfer(file.text, file.name);
        if (parsed.fromNewerFormat) newer = true;
        for (const diagram of parsed.diagrams) incoming.push({ diagram, file: file.name });
      }
    } catch (err) {
      this.set({ error: describe(err) });
      return;
    }

    this.set({
      error: null,
      importPlan: {
        candidates: planImport(incoming, this.state.diagrams),
        warning: newer
          ? 'This was written by a newer version of diagram-plus. Anything it added that ' +
            'this version does not know about will not survive the import.'
          : null,
      },
    });
  }

  cancelImport(): void {
    this.set({ importPlan: null });
  }

  /** Carry out the import the user confirmed, one diagram at a time. */
  async commitImport(candidates: ImportCandidate[]): Promise<void> {
    const chosen = candidates.filter((candidate) => candidate.action !== 'skip');
    if (!chosen.length) {
      this.set({ importPlan: null });
      return;
    }

    // Overwriting the diagram on screen would take its unsaved edits with it,
    // so it asks the same question that opening another diagram asks.
    const open = this.state.current;
    const hitsOpen = chosen.some(
      (candidate) => candidate.action === 'replace' && candidate.existing?.slug === open?.slug,
    );
    if (hitsOpen && this.state.dirty && !(await this.confirmDiscard('import'))) return;

    const imported: Diagram[] = [];
    let failed: string | null = null;
    for (const candidate of chosen) {
      try {
        const { diagram } = await api.importDiagram({
          diagram: candidate.incoming,
          action: candidate.action === 'replace' ? 'replace' : 'copy',
          target: candidate.action === 'replace' ? candidate.existing?.slug : undefined,
        });
        imported.push(diagram);
      } catch (err) {
        // Stop rather than carry on: the ones already written stay, and the
        // message names the one that did not so the user knows where it got to.
        failed = `Could not import “${candidate.incoming.name}”: ${describe(err)}`;
        break;
      }
    }

    const list = await api.listDiagrams().catch(() => ({ diagrams: this.state.diagrams }));
    this.set({
      diagrams: list.diagrams,
      importPlan: null,
      error: failed,
      notice: imported.length
        ? `Imported ${imported.length} diagram${imported.length === 1 ? '' : 's'}.`
        : null,
    });

    const last = imported[imported.length - 1];
    if (!last) return;

    if (open && imported.some((diagram) => diagram.slug === open.slug)) {
      // What the user was looking at has just been overwritten underneath them.
      this.undoStack = [];
      this.redoStack = [];
      this.set({ dirty: false });
      await this.reload();
      return;
    }
    // Land on what was just imported, unless unsaved work elsewhere would have
    // to be interrupted to get there.
    if (!this.state.dirty) await this.open(last.slug);
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  /* ---- history --------------------------------------------------------- */

  private pushHistory(): void {
    const current = this.state.current;
    if (!current) return;
    this.undoStack.push(structuredClone(current));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Undo applies to the document on screen, which is the only sane reading. */
  undo(): void {
    if (this.state.view === 'design') return this.undoDesign();
    const previous = this.undoStack.pop();
    const current = this.state.current;
    if (!previous || !current) return;
    this.redoStack.push(structuredClone(current));
    this.edit(previous);
  }

  redo(): void {
    if (this.state.view === 'design') return this.redoDesign();
    const next = this.redoStack.pop();
    const current = this.state.current;
    if (!next || !current) return;
    this.undoStack.push(structuredClone(current));
    this.edit(next);
  }

  private undoDesign(): void {
    const previous = this.designUndoStack.pop();
    const design = this.state.design;
    if (!previous || !design) return;
    this.designRedoStack.push(structuredClone(design));
    this.setDesign(previous, { designDirty: true });
  }

  private redoDesign(): void {
    const next = this.designRedoStack.pop();
    const design = this.state.design;
    if (!next || !design) return;
    this.designUndoStack.push(structuredClone(design));
    this.setDesign(next, { designDirty: true });
  }

  /* ---- ui state --------------------------------------------------------- */

  select(blocks: string[], edges: string[] = []): void {
    this.set({ selectedBlocks: blocks, selectedEdges: edges });
  }

  setPanel(panel: Panel): void {
    this.set({ panel: this.state.panel === panel ? null : panel });
  }

  /* ---- the client view -------------------------------------------------- */

  /**
   * Which of the two documents is on screen. They are separate views of the
   * same file rather than a canvas and a panel, because the client view is
   * something you work in for an hour with somebody watching, not something
   * you glance at.
   */
  setView(view: EditorView): void {
    if (view === this.state.view) return;
    this.set({ view, selectedClient: [], ...this.historyFlags(view) });
    if (view === 'client') this.primeClientView();
    if (view === 'design' && !this.state.design) void this.loadDesign();
  }

  /**
   * The client view as it stands: the one saved in the file, or a freshly
   * derived draft if the file has never had one.
   *
   * The draft is held in the editor rather than written into the diagram, so
   * opening the tab to look at it does not mark the file as changed. The first
   * actual edit is what commits it.
   */
  clientView(): ClientView | null {
    const current = this.state.current;
    if (!current) return null;
    return current.clientView ?? this.state.clientDraft;
  }

  private primeClientView(): void {
    const current = this.state.current;
    if (!current || current.clientView || this.state.clientDraft) return;
    this.set({ clientDraft: deriveClientView(current, this.state.treeOptions) });
  }

  /** Commit a changed view to the local copy of the diagram. */
  private commitClientView(view: ClientView, history = true): void {
    const current = this.state.current;
    if (!current) return;
    if (history) this.pushHistory();
    const next: Diagram = structuredClone(current);
    next.clientView = view;
    this.set({ clientDraft: null });
    this.edit(next);
  }

  /**
   * Edit the client view. Every change made in front of a client — a rename, a
   * new box, an arrow — arrives here, in the same vocabulary the MCP tools
   * use, so Claude and the person in the meeting are making the same kind of
   * change to the same document.
   */
  clientEdit(operations: ClientViewOperation[], options: { history?: boolean } = {}): void {
    const view = this.clientView();
    if (!view || !operations.length) return;
    const result = editClientView(view, operations);
    if (result.errors.length) {
      this.set({ error: result.errors[0]?.message ?? 'That change could not be made.' });
    }
    if (!result.applied) return;
    this.commitClientView(result.view, options.history !== false);
  }

  /** Re-flow the boxes, including the ones that were dragged. */
  tidyClientView(): void {
    const view = this.clientView();
    if (!view) return;
    this.commitClientView(layoutClientView(view, { includePinned: true }));
  }

  /** Bring the view up to date with the diagram, keeping the client's work. */
  syncClientView(): void {
    const current = this.state.current;
    const view = this.clientView();
    if (!current || !view) return;
    const result = reconcileClientView(current, view, this.state.treeOptions);
    this.commitClientView(result.view);
    const parts: string[] = [];
    if (result.added.length) parts.push(`${result.added.length} new`);
    if (result.updated.length) parts.push(`${result.updated.length} reworded`);
    if (result.orphaned.length) parts.push(`${result.orphaned.length} no longer in the diagram`);
    this.set({
      notice: parts.length
        ? `Client view updated from the diagram: ${parts.join(', ')}.`
        : 'The client view was already up to date.',
    });
  }

  /**
   * Carry what the client changed into the technical diagram.
   *
   * The same operation `apply_client_view` performs over MCP — offered here
   * too because after a review the user is already looking at the changes and
   * should not have to go and ask for them to be applied.
   */
  applyClientView(includeRemovals = false): void {
    const current = this.state.current;
    if (!current) return;
    const view = this.clientView();
    if (!view) return;

    this.pushHistory();
    const next: Diagram = structuredClone(current);
    next.clientView = view;
    const result = applyClientView(next, { includeRemovals });
    this.set({ clientDraft: null, notice: result.summary });
    this.edit(next);
  }

  /** What the client view has that the diagram does not, and the other way. */
  clientChanges(): ClientViewDiff | null {
    const current = this.state.current;
    const view = this.clientView();
    return current && view ? diffClientView(current, view) : null;
  }

  selectClient(ids: string[]): void {
    this.set({ selectedClient: ids });
  }

  setTreeOptions(patch: Partial<TreeOptions>): void {
    const treeOptions = { ...this.state.treeOptions, ...patch };
    this.set({ treeOptions });

    // The audience and the filters are part of the client view document, so
    // changing them re-derives it — keeping everything the client did to it.
    const current = this.state.current;
    if (!current) return;
    if (current.clientView) {
      this.commitClientView(reconcileClientView(current, current.clientView, treeOptions).view);
    } else {
      this.set({ clientDraft: deriveClientView(current, treeOptions) });
    }
  }

  setTreeFilter(patch: Partial<TreeFilter>): void {
    const filter = { ...this.state.treeOptions.filter, ...patch };
    // An empty value means "no longer filtering on this", not "match nothing".
    for (const [key, value] of Object.entries(filter)) {
      const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);
      if (empty) delete (filter as Record<string, unknown>)[key];
    }
    this.setTreeOptions({ filter });
  }

  /* ---- the screen designs ----------------------------------------------- */

  /**
   * Fetch the designs for the open diagram.
   *
   * A project that has never been designed gets a document derived from the
   * diagram — a wireframe per screen — without anything being written, so
   * opening the tab to look never creates a file. `designSaved` records which
   * of the two it is, and the strip along the bottom says so.
   */
  async loadDesign(): Promise<void> {
    const current = this.state.current;
    if (!current || this.state.designLoading) return;

    this.set({ designLoading: true });
    try {
      const result = await api.getDesign(current.slug);
      this.designUndoStack = [];
      this.designRedoStack = [];
      this.setDesign(result.design, {
        designLoading: false,
        designSaved: result.saved ?? true,
        designDirty: false,
        error: null,
      });
    } catch (err) {
      this.set({ designLoading: false, error: describe(err) });
    }
  }

  /**
   * Edit the designs.
   *
   * Every change made in the editor — a dragged element, a renamed layer, a
   * retyped button — arrives here in the same vocabulary the MCP tools use, so
   * a screen worked on by hand and one drawn by Claude are the same kind of
   * change to the same document.
   *
   * Local, like every diagram edit: nothing reaches the file until a save.
   */
  designEdit(operations: DesignOperation[], options: { history?: boolean } = {}): void {
    const design = this.state.design;
    if (!design || !operations.length) return;

    const result = editDesign(design, operations);
    if (result.errors.length) {
      this.set({ error: result.errors[0]?.message ?? 'That change could not be made.' });
    }
    if (!result.applied) return;

    if (options.history !== false) this.pushDesignHistory();
    this.setDesign(result.document, { designDirty: true });
  }

  private pushDesignHistory(): void {
    const design = this.state.design;
    if (!design) return;
    this.designUndoStack.push(structuredClone(design));
    if (this.designUndoStack.length > HISTORY_LIMIT) this.designUndoStack.shift();
    this.designRedoStack = [];
  }

  private async saveDesign(): Promise<void> {
    const current = this.state.current;
    const design = this.state.design;
    if (!current || !design || !this.state.designDirty || this.state.designSaving) return;

    this.set({ designSaving: true });
    try {
      const result = await api.replaceDesign(current.slug, design);
      // A design edited while the write was in flight is still unsaved, and
      // the local copy stays as it is — the reply is already behind it.
      const editedSince = this.state.design !== design;
      this.setDesign(editedSince ? this.state.design : result.design, {
        designSaving: false,
        designDirty: editedSince,
        designSaved: true,
        error: null,
      });
    } catch (err) {
      this.set({ designSaving: false, error: describe(err) });
    }
  }

  /** Which artboard is being worked on, and which element within it. */
  selectScreen(id: string | null): void {
    this.set({ selectedScreen: id, selectedElement: null });
  }

  selectElement(id: string | null, screen?: string): void {
    this.set({
      selectedElement: id,
      ...(screen ? { selectedScreen: screen } : {}),
    });
  }

  setDesignPanel(panel: 'layers' | 'tokens'): void {
    this.set({ designPanel: panel });
  }

  /** The artboard currently being worked on. */
  currentScreen(): ScreenDesign | null {
    const design = this.state.design;
    if (!design) return null;
    return design.screens.find((s) => s.id === this.state.selectedScreen) ?? null;
  }

  /**
   * The element currently selected, as the facts the inspector edits.
   *
   * Selection is stored as a bare `data-el` string and resolved against the
   * markup on every read, exactly as it used to be resolved against the tree.
   * That is what lets an edit from anywhere — the canvas, Claude, a reload —
   * leave the selection pointing at the right thing or at nothing.
   */
  currentElement(): ElementFacts | null {
    const screen = this.currentScreen();
    if (!screen || !this.state.selectedElement) return null;
    const found = findHtml(parseHtml(screen.html), this.state.selectedElement);
    return found ? factsOf(found) : null;
  }

  /** Read-only view of the editor state, for callers outside the class. */
  get current(): EditorState {
    return this.state;
  }

  /**
   * Bring the designs up to date with the diagram, keeping what has been drawn.
   *
   * This one writes rather than editing locally: seeding a dozen screens is
   * not something to leave sitting in an unsaved buffer, and it is the same
   * operation `sync_screen_designs` performs over MCP.
   */
  async syncDesign(rebuild = false): Promise<void> {
    const current = this.state.current;
    if (!current) return;
    if (this.state.designDirty) await this.saveDesign();

    this.set({ designLoading: true });
    try {
      const result = await api.syncDesign(current.slug, rebuild);
      this.designUndoStack = [];
      this.designRedoStack = [];
      this.setDesign(result.design, {
        designLoading: false,
        designSaved: true,
        designDirty: false,
        error: null,
      });

      const report = result.report;
      const parts: string[] = [];
      if (report?.added.length) parts.push(`${report.added.length} seeded from the diagram`);
      if (report?.updated.length) parts.push(`${report.updated.length} refreshed`);
      if (report?.orphaned.length) {
        parts.push(`${report.orphaned.length} no longer in the diagram`);
      }
      this.set({
        notice: parts.length
          ? `Designs updated: ${parts.join(', ')}.`
          : 'The designs were already up to date.',
      });
    } catch (err) {
      this.set({ designLoading: false, error: describe(err) });
    }
  }

  /** Re-flow the artboards into a grid, including ones that were dragged. */
  tidyDesign(): void {
    const design = this.state.design;
    if (!design) return;
    this.pushDesignHistory();
    this.setDesign(layoutDesign(design, { includePinned: true }), { designDirty: true });
  }

  /** Fill the window — the state to be in on a call with a client. */
  present(on: boolean): void {
    this.set({ presenting: on, panel: on ? null : this.state.panel });
    if (on) {
      this.set({ view: 'client' });
      this.primeClientView();
    }
  }

  async exportTree(format: 'tree' | 'tree-markdown'): Promise<void> {
    const current = this.state.current;
    if (!current) return;
    try {
      const tree = buildProjectTree(current, this.state.treeOptions);
      const contents = format === 'tree-markdown' ? treeToMarkdown(tree) : treeToText(tree);
      const name = `${current.slug}-client-view.${format === 'tree-markdown' ? 'md' : 'txt'}`;
      const path = await saveFile(name, contents);
      if (path) this.set({ notice: `Wrote the client view to ${path}.`, error: null });
    } catch (err) {
      this.set({ error: describe(err) });
    }
  }

  /** Put a message in the notice strip — for failures with no other home. */
  reportError(message: string): void {
    this.set({ error: message });
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

/** Folder name of a project root, for naming an exported bundle. */
function projectName(root: string): string {
  return root.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '') || 'diagrams';
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
