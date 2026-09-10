import { useSyncExternalStore } from 'react';

/**
 * The "you have unsaved changes" question.
 *
 * Editing is local until the user saves, so anything that would throw those
 * edits away — closing the window, switching diagrams — has to ask first. The
 * asking is a promise here and a dialog in `UnsavedDialog`, which keeps the
 * editor store free of React while still letting it wait for an answer.
 */

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/** What the user was trying to do, so the dialog can say so. */
export type UnsavedReason = 'close' | 'switch' | 'project' | 'import';

export interface UnsavedPromptState {
  reason: UnsavedReason | null;
}

class UnsavedPrompt {
  private state: UnsavedPromptState = { reason: null };
  private listeners = new Set<() => void>();
  private answer: ((choice: UnsavedChoice) => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): UnsavedPromptState => this.state;

  private set(state: UnsavedPromptState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Show the dialog and resolve with what the user picked. */
  ask(reason: UnsavedReason): Promise<UnsavedChoice> {
    // A second ask while one is open replaces it rather than stacking.
    this.answer?.('cancel');
    this.set({ reason });
    return new Promise<UnsavedChoice>((resolve) => {
      this.answer = resolve;
    });
  }

  /** Called by the dialog. */
  respond(choice: UnsavedChoice): void {
    const answer = this.answer;
    this.answer = null;
    this.set({ reason: null });
    answer?.(choice);
  }
}

export const unsavedPrompt = new UnsavedPrompt();

export function useUnsavedPrompt(): UnsavedPromptState {
  return useSyncExternalStore(
    unsavedPrompt.subscribe,
    unsavedPrompt.getState,
    unsavedPrompt.getState,
  );
}
