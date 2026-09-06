import { useState } from 'react';
import { project, useProject, type RecentProject } from '../desktop';

/**
 * What the desktop app shows before a project is open.
 *
 * There is no library and no import step: a project is a folder, and its
 * diagrams live in `.diagrams/` inside it, next to the code they describe.
 * Opening one is opening a folder, so this screen is a folder picker with a
 * memory.
 */

export function Welcome() {
  const { recent } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setBusy(true);
    setError(null);
    try {
      await project.pick();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      await project.open(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark">
          diagram<span style={{ color: 'var(--accent)' }}>+</span>
        </div>
        <h1>Open a project</h1>
        <p className="welcome-lead">
          Diagrams are stored as JSON in a <code>.diagrams</code> folder inside your project, so
          they are reviewed and committed alongside the code they describe. Choose the folder you
          want to design.
        </p>

        <button className="btn primary large" onClick={() => void pick()} disabled={busy}>
          Choose a folder…
        </button>

        {error ? <p className="welcome-error">{error}</p> : null}

        {recent.length ? (
          <div className="welcome-recent">
            <h2>Recent</h2>
            <ul>
              {recent.map((entry) => (
                <RecentRow
                  key={entry.path}
                  entry={entry}
                  busy={busy}
                  onOpen={() => void open(entry.path)}
                  onForget={() => void project.forget(entry.path)}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecentRow({
  entry,
  busy,
  onOpen,
  onForget,
}: {
  entry: RecentProject;
  busy: boolean;
  onOpen: () => void;
  onForget: () => void;
}) {
  return (
    <li className={entry.exists ? '' : 'missing'}>
      <button className="recent-open" onClick={onOpen} disabled={busy || !entry.exists}>
        <strong>{entry.name}</strong>
        <span>{entry.exists ? entry.path : `${entry.path} — no longer there`}</span>
      </button>
      <button className="btn subtle small" onClick={onForget} title="Remove from this list">
        ✕
      </button>
    </li>
  );
}
