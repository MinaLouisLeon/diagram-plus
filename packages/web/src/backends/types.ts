import type {
  BatchOperation,
  ImportAction,
  BlockTypeInfo,
  BlockCategory,
  DesignDiff,
  DesignDocument,
  DesignOperation,
  DesignProgress,
  Diagram,
  DiagramSummary,
  EdgeTypeInfo,
  ElementCategory,
  ElementTypeInfo,
  ValidationResult,
} from '@diagram-plus/core/browser';

/**
 * What the editor needs from whatever is holding the diagrams.
 *
 * There are two implementations. In the browser it is the local `dgp` server,
 * reached over REST and a WebSocket. In the desktop app it is Tauri: the same
 * core logic runs in the webview and Rust supplies the filesystem. The editor
 * itself cannot tell which one it has, which is the point — one editor, two
 * shells, no forked UI code.
 */

export interface Catalog {
  blockTypes: BlockTypeInfo[];
  categories: { id: BlockCategory; label: string }[];
  edgeTypes: EdgeTypeInfo[];
  colors: Record<string, string>;
  /** The design palette. Optional so an older server still starts the editor. */
  elementTypes?: ElementTypeInfo[];
  elementCategories?: { id: ElementCategory; label: string }[];
}

/** What comes back from any of the design endpoints. */
export interface DesignResult {
  design: DesignDocument;
  changes?: DesignDiff;
  progress?: DesignProgress;
  /** False while the designs are only derived and have never been saved. */
  saved?: boolean;
  result?: { applied: number; errors: unknown[] };
  report?: { added: string[]; updated: string[]; orphaned: string[] };
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

export interface BatchOutcome {
  applied: number;
  errors: unknown[];
}

export interface Api {
  catalog(): Promise<Catalog>;
  listDiagrams(): Promise<{ diagrams: DiagramSummary[] }>;
  getDiagram(slug: string): Promise<{ diagram: Diagram }>;
  createDiagram(body: {
    name: string;
    description?: string;
    projectGoal?: string;
  }): Promise<{ diagram: Diagram }>;
  deleteDiagram(slug: string): Promise<{ deleted: string }>;
  patchDiagram(slug: string, body: Record<string, unknown>): Promise<{ diagram: Diagram }>;
  replaceDiagram(slug: string, diagram: Diagram): Promise<{ diagram: Diagram }>;
  /**
   * Write a diagram that came from another project.
   *
   * The file is read and the collision resolved in the editor, so this only
   * carries out a decision the user has already seen and made. `target` is the
   * diagram being overwritten, and is required to replace.
   */
  importDiagram(body: {
    diagram: Diagram;
    action: Exclude<ImportAction, 'skip'>;
    target?: string;
  }): Promise<{ diagram: Diagram; action: string; replaced: string | null }>;
  batch(
    slug: string,
    operations: BatchOperation[],
    layout?: boolean,
  ): Promise<{ diagram: Diagram; result: BatchOutcome }>;
  layout(slug: string, direction: 'LR' | 'TB'): Promise<{ diagram: Diagram }>;
  spec(slug: string): Promise<{ markdown: string }>;
  validate(slug: string): Promise<{ validation: ValidationResult }>;
  export(
    slug: string,
    format: 'mermaid' | 'markdown' | 'json',
  ): Promise<{ format: string; content: string }>;

  /* ---- the screen designs ------------------------------------------- */

  /**
   * Read the designs. A project that has never been designed gets a document
   * derived from the diagram without anything being written, so opening the
   * tab to look never creates a file.
   */
  getDesign(slug: string): Promise<DesignResult>;
  /** Replace the whole document — what undo/redo and a canvas save send. */
  replaceDesign(slug: string, design: DesignDocument): Promise<DesignResult>;
  /** Apply design operations, the vocabulary the MCP tools also use. */
  designOps(
    slug: string,
    operations: DesignOperation[],
    layout?: boolean,
  ): Promise<DesignResult>;
  /** Seed designs for new screens, keeping everything already drawn. */
  syncDesign(slug: string, rebuild?: boolean): Promise<DesignResult>;
  arrangeDesign(slug: string, includePinned?: boolean): Promise<DesignResult>;
}

export type LiveMessage =
  | { type: 'hello'; diagrams: DiagramSummary[]; root: string }
  | { type: 'diagram:changed'; slug: string; revision: number; source: string; diagram: Diagram }
  | { type: 'diagram:deleted'; slug: string }
  | {
      type: 'design:changed';
      slug: string;
      revision: number;
      source: string;
      design: DesignDocument;
    }
  | { type: 'design:deleted'; slug: string };

export interface LiveConnection {
  close: () => void;
}

export type LiveStatus = 'connecting' | 'open' | 'closed';

export interface Backend {
  api: Api;
  connectLive(
    onMessage: (message: LiveMessage) => void,
    onStatus: (status: LiveStatus) => void,
  ): LiveConnection;
}
