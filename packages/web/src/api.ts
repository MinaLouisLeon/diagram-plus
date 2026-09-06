import { isDesktop } from './desktop';
import { httpBackend } from './backends/http';
import { tauriBackend } from './backends/tauri';

/**
 * Picks the backend the editor is running against.
 *
 * In a browser that is the local `dgp` server over REST; in the packaged
 * desktop app it is Tauri. Nothing above this line knows which, so the whole
 * editor is written once.
 */

const backend = isDesktop() ? tauriBackend : httpBackend;

export const api = backend.api;
export const connectLive = backend.connectLive;

export { ApiError } from './backends/types';
export type {
  Api,
  Backend,
  BatchOutcome,
  Catalog,
  LiveConnection,
  LiveMessage,
  LiveStatus,
} from './backends/types';
