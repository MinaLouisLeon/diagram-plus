import type {
  BatchOperation,
  BlockTypeInfo,
  BlockCategory,
  Diagram,
  DiagramSummary,
  EdgeTypeInfo,
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
}

export type LiveMessage =
  | { type: 'hello'; diagrams: DiagramSummary[]; root: string }
  | { type: 'diagram:changed'; slug: string; revision: number; source: string; diagram: Diagram }
  | { type: 'diagram:deleted'; slug: string };

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
