import { useMemo, useState } from 'react';
import {
  diagramStats,
  importTarget,
  type ImportAction,
  type ImportCandidate,
} from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';

/**
 * What is about to happen to each file being imported.
 *
 * An import almost always means overwriting a diagram — that is the shape of
 * the round trip it exists for: send it out, get it back edited, put it back.
 * So this shows both sides before anything is written, and says in words where
 * each file will land. Nothing here is destructive until Import is pressed.
 */

export function ImportDialog() {
  const { importPlan, diagrams } = useEditorState();
  const [actions, setActions] = useState<Record<number, ImportAction>>({});
  const [busy, setBusy] = useState(false);

  const candidates = importPlan?.candidates ?? [];

  // Recomputed as the choices change, because whether a copy needs a free slug
  // depends on the other files in the same import, not just on what is on disk.
  const resolved = useMemo(() => {
    const taken = new Set(diagrams.map((diagram) => diagram.slug));
    return candidates.map((candidate, index) => {
      const action = actions[index] ?? candidate.action;
      if (action === 'skip') return { ...candidate, action, lands: null };
      const lands = importTarget(candidate.incoming, action, candidate.existing, taken);
      taken.add(lands.slug);
      return { ...candidate, action, lands };
    });
  }, [candidates, actions, diagrams]);

  if (!importPlan) return null;

  const chosen = resolved.filter((candidate) => candidate.action !== 'skip');
  const replacing = resolved.filter((candidate) => candidate.action === 'replace').length;

  const cancel = () => {
    if (busy) return;
    setActions({});
    store.cancelImport();
  };

  const confirm = async () => {
    setBusy(true);
    await store.commitImport(resolved.map(({ lands: _lands, ...candidate }) => candidate));
    setBusy(false);
    setActions({});
  };

  return (
    <div className="overlay" onClick={cancel}>
      <div className="modal wide" onClick={(event) => event.stopPropagation()} role="dialog">
        <header>
          Import {candidates.length === 1 ? 'a diagram' : `${candidates.length} diagrams`}
        </header>

        <div className="modal-body">
          {importPlan.warning ? <p className="import-warning">{importPlan.warning}</p> : null}

          <div className="import-list">
            {resolved.map((candidate, index) => (
              <ImportRow
                key={`${candidate.file}-${candidate.incoming.id}-${index}`}
                candidate={candidate}
                onAction={(action) => setActions((prev) => ({ ...prev, [index]: action }))}
              />
            ))}
          </div>
        </div>

        <footer>
          <span className="hint import-summary">
            {chosen.length === 0
              ? 'Nothing selected.'
              : replacing > 0
                ? `${replacing} diagram${replacing === 1 ? '' : 's'} in this project will be overwritten.`
                : `${chosen.length} will be added.`}
          </span>
          <button className="btn subtle" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${replacing > 0 ? 'danger' : 'primary'}`}
            onClick={() => void confirm()}
            disabled={busy || chosen.length === 0}
          >
            {busy ? 'Importing…' : replacing > 0 ? 'Overwrite and import' : 'Import'}
          </button>
        </footer>
      </div>
    </div>
  );
}

type ResolvedCandidate = ImportCandidate & { lands: { name: string; slug: string } | null };

function ImportRow({
  candidate,
  onAction,
}: {
  candidate: ResolvedCandidate;
  onAction: (action: ImportAction) => void;
}) {
  const { incoming, existing, matchedBy, action, lands, file } = candidate;
  const stats = diagramStats(incoming);

  return (
    <div className={`import-row${action === 'skip' ? ' skipped' : ''}`}>
      <div className="import-head">
        <strong>{incoming.name}</strong>
        <span className="hint">{file}</span>
      </div>

      <div className="import-sides">
        <div className="import-side">
          <div className="section-label">Incoming</div>
          <p>
            {stats.blocks} blocks · {stats.edges} connections · {incoming.status}
          </p>
          <p className="hint">{when(incoming.updatedAt)}</p>
        </div>

        <div className="import-side">
          <div className="section-label">{existing ? 'Already here' : 'This project'}</div>
          {existing ? (
            <>
              <p>
                {existing.blockCount} blocks · {existing.edgeCount} connections · {existing.status}
              </p>
              <p className="hint">
                {when(existing.updatedAt)}
                {existing.name !== incoming.name ? ` · named “${existing.name}”` : ''}
              </p>
            </>
          ) : (
            <p className="hint">Nothing here matches it — this is a new diagram.</p>
          )}
        </div>
      </div>

      {existing ? (
        <p className="hint import-match">
          Matched by {MATCH_REASON[matchedBy ?? 'name']}.
        </p>
      ) : null}

      <div className="import-actions">
        {existing ? (
          <Choice
            checked={action === 'replace'}
            onSelect={() => onAction('replace')}
            label="Replace"
            detail={`Overwrite ${existing.slug}${DIAGRAM_SUFFIX}`}
          />
        ) : null}
        <Choice
          checked={action === 'copy'}
          onSelect={() => onAction('copy')}
          label={existing ? 'Keep both' : 'Add'}
          detail={
            action === 'copy' && lands
              ? `Add as “${lands.name}”`
              : existing
                ? 'Add alongside the one already here'
                : 'Add to this project'
          }
        />
        <Choice
          checked={action === 'skip'}
          onSelect={() => onAction('skip')}
          label="Skip"
          detail="Leave this one out"
        />
      </div>
    </div>
  );
}

const DIAGRAM_SUFFIX = '.diagram.json';

const MATCH_REASON: Record<'id' | 'slug' | 'name', string> = {
  id: 'diagram id — it is the same diagram, wherever it has been since',
  slug: 'file name',
  name: 'name',
};

function Choice({
  checked,
  onSelect,
  label,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  detail: string;
}) {
  return (
    <label className={`import-choice${checked ? ' active' : ''}`}>
      <input type="radio" checked={checked} onChange={onSelect} />
      <span>
        <strong>{label}</strong>
        <em>{detail}</em>
      </span>
    </label>
  );
}

/** A date the way a person reads one, falling back to the raw value. */
function when(iso: string): string {
  if (!iso) return 'never saved';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `edited ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}
