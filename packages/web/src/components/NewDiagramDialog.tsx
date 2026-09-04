import { useState } from 'react';
import { store } from '../store';

/** The one modal in the app: naming a new diagram. */

export function NewDiagramDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const created = await store.createDiagram(name.trim(), goal.trim() || undefined);
    setBusy(false);
    if (created) onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>New diagram</header>
        <div className="modal-body">
          <div className="field">
            <label>Name</label>
            <input
              className="control"
              autoFocus
              value={name}
              placeholder="Recipe sharing app"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <div className="field">
            <label>What are you building?</label>
            <textarea
              className="control"
              value={goal}
              placeholder="A place to save recipes, plan a week of meals and generate a shopping list."
              onChange={(e) => setGoal(e.target.value)}
            />
            <p className="hint">
              Optional, but it is carried into the spec Claude implements from — worth a sentence.
            </p>
          </div>
        </div>
        <footer>
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
