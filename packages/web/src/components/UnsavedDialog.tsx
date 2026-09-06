import { useEditorState } from '../store';
import { unsavedPrompt, useUnsavedPrompt, type UnsavedReason } from '../unsaved';

/**
 * Asked when unsaved edits are about to be thrown away — on the way out of the
 * app, or on the way to another diagram. There is no default answer: all three
 * are one click, and dismissing the dialog means "not yet".
 */

const REASONS: Record<UnsavedReason, string> = {
  close: 'Closing now would lose those changes.',
  switch: 'Opening another diagram would lose those changes.',
  project: 'Opening another project would lose those changes.',
};

export function UnsavedDialog() {
  const { reason } = useUnsavedPrompt();
  const { current } = useEditorState();

  if (!reason) return null;

  const cancel = () => unsavedPrompt.respond('cancel');

  return (
    <div className="overlay" onClick={cancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="alertdialog">
        <header>Save your changes?</header>
        <div className="modal-body">
          <p className="modal-lead">
            You have edited <strong>{current?.name ?? 'this diagram'}</strong> without saving.{' '}
            {REASONS[reason]}
          </p>
        </div>
        <footer>
          <button className="btn subtle" onClick={cancel}>
            Cancel
          </button>
          <button className="btn danger" onClick={() => unsavedPrompt.respond('discard')}>
            {reason === 'close' ? 'Close without saving' : 'Discard changes'}
          </button>
          <button className="btn primary" autoFocus onClick={() => unsavedPrompt.respond('save')}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
