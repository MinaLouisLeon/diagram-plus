import { useEffect, useState } from 'react';
import {
  BLOCK_CATALOG,
  clientWordFor,
  type BlockType,
  type ClientNode,
  type ClientView as ClientViewModel,
  type ClientViewDiff,
  type TreeFilter,
} from '@diagram-plus/core/browser';
import { ClientCanvas } from './ClientCanvas';
import { ProjectTreeView, TreeActions, useProjectTree } from './ProjectTreeView';
import { store, useEditorState } from '../store';

/**
 * The client view, filling the workspace.
 *
 * It is a whole view rather than a panel because of what it is for: sitting
 * with a client for an hour, walking through the project, and changing it
 * while they talk. That does not fit in a drawer.
 *
 * What they change is stored here and stays here — the technical diagram is
 * only touched when somebody asks for it, either from the strip along the
 * bottom or by Claude through `apply_client_view`.
 */

export function ClientView() {
  const { current, treeOptions, selectedClient } = useEditorState();
  const view = store.clientView();
  const [mode, setMode] = useState<'boxes' | 'list'>('boxes');

  if (!current || !view) return null;
  const selected = view.nodes.find((node) => node.id === selectedClient[0]) ?? null;
  const changes = store.clientChanges();

  return (
    <div className="client-view">
      <header className="client-bar">
        <div className="seg" role="group" aria-label="How it is drawn">
          <button
            className={`btn small${mode === 'boxes' ? ' primary' : ''}`}
            onClick={() => setMode('boxes')}
            title="Boxes and arrows"
          >
            Boxes
          </button>
          <button
            className={`btn small${mode === 'list' ? ' primary' : ''}`}
            onClick={() => setMode('list')}
            title="The same thing as an indented list, for copying"
          >
            List
          </button>
        </div>

        <TreeControls />

        <div className="toolbar-spacer" />

        <button className="btn small" onClick={() => store.tidyClientView()} title="Re-flow every box">
          Tidy up
        </button>
        <button
          className="btn small"
          onClick={() => store.syncClientView()}
          title="Bring in changes made to the technical diagram, keeping everything here"
        >
          Update from diagram
        </button>
        <button
          className="btn small primary"
          onClick={() => store.present(true)}
          title="Fill the window — the view to share on a call"
        >
          Present
        </button>
      </header>

      <div className="client-body">
        {mode === 'boxes' ? (
          <ClientCanvas view={view} />
        ) : (
          <ClientList />
        )}
        {selected ? <ClientInspector node={selected} view={view} /> : null}
      </div>

      {changes ? <ChangeStrip changes={changes} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

/** The knobs, shared by the workspace and the presentation overlay's header. */
function TreeControls({ compact = false }: { compact?: boolean }) {
  const { current, treeOptions } = useEditorState();
  const filter: TreeFilter = treeOptions.filter ?? {};
  const groups = current?.groups ?? [];
  const tags = [...new Set((current?.blocks ?? []).flatMap((b) => b.tags))].sort();

  return (
    <>
      <div className="seg" role="group" aria-label="Who this is for">
        <button
          className={`btn small${(treeOptions.audience ?? 'client') === 'client' ? ' primary' : ''}`}
          onClick={() => store.setTreeOptions({ audience: 'client' })}
          title="Hide endpoints, services and tables"
        >
          Client
        </button>
        <button
          className={`btn small${treeOptions.audience === 'technical' ? ' primary' : ''}`}
          onClick={() => store.setTreeOptions({ audience: 'technical' })}
          title="Keep every block in the diagram"
        >
          Technical
        </button>
      </div>

      <label className="check" title="Turn decisions and conditional connections into branches">
        <input
          type="checkbox"
          checked={treeOptions.showConditions ?? true}
          onChange={(event) => store.setTreeOptions({ showConditions: event.target.checked })}
        />
        Conditions
      </label>

      <label className="check" title="Include data models and datastores">
        <input
          type="checkbox"
          checked={treeOptions.showData ?? false}
          onChange={(event) => store.setTreeOptions({ showData: event.target.checked })}
        />
        Data
      </label>

      {compact ? null : (
        <>
          {groups.length ? (
            <select
              value={filter.groups?.[0] ?? ''}
              onChange={(event) =>
                store.setTreeFilter({ groups: event.target.value ? [event.target.value] : [] })
              }
              title="Only show one part of the project"
            >
              <option value="">Every group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : null}

          {tags.length ? (
            <select
              value={filter.tags?.[0] ?? ''}
              onChange={(event) =>
                store.setTreeFilter({ tags: event.target.value ? [event.target.value] : [] })
              }
              title="Only show blocks carrying this tag"
            >
              <option value="">Every tag</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          ) : null}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The box being edited
 * ------------------------------------------------------------------ */

function ClientInspector({ node, view }: { node: ClientNode; view: ClientViewModel }) {
  const { catalog } = useEditorState();
  const ordered = [...view.nodes].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((n) => n.id === node.id);

  const edit = (patch: Record<string, unknown>): void =>
    store.clientEdit([{ op: 'update_node', node: node.id, ...patch } as never]);

  const move = (to: number): void => {
    const next = [...ordered];
    next.splice(to, 0, ...next.splice(index, 1));
    store.clientEdit([{ op: 'reorder', order: next.map((n) => n.id) }]);
  };

  return (
    <aside className="client-inspector">
      <div className="client-inspector-head">
        <strong>{node.name}</strong>
        <span className="client-node-kind">{clientWordFor(node.type)}</span>
        <button className="btn subtle icon" onClick={() => store.selectClient([])} title="Close">
          ×
        </button>
      </div>

      <label>
        Name
        <input
          value={node.name}
          onChange={(event) => edit({ name: event.target.value })}
          placeholder="What the client calls it"
        />
      </label>

      <label>
        One line about it
        <input
          value={node.description}
          onChange={(event) => edit({ description: event.target.value })}
          placeholder="What happens here, in plain words"
        />
      </label>

      <label>
        What it really is
        <select value={node.type} onChange={(event) => edit({ type: event.target.value as BlockType })}>
          {(catalog?.categories ?? []).map((category) => (
            <optgroup key={category.id} label={category.label}>
              {(catalog?.blockTypes ?? [])
                .filter((info) => info.category === category.id)
                .map((info) => (
                  <option key={info.type} value={info.type}>
                    {info.label}
                  </option>
                ))}
            </optgroup>
          ))}
          {catalog ? null : (
            <>
              {(Object.keys(BLOCK_CATALOG) as BlockType[]).map((type) => (
                <option key={type} value={type}>
                  {BLOCK_CATALOG[type].label}
                </option>
              ))}
            </>
          )}
        </select>
      </label>

      {node.type === 'decision' ? (
        <>
          <label>
            The question
            <input
              value={node.condition}
              onChange={(event) => edit({ condition: event.target.value })}
              placeholder="Did the payment go through?"
            />
          </label>
          <div className="client-branches">
            <span className="label">What can happen</span>
            {node.branches.map((branch, at) => (
              <div key={at} className="client-branch-row">
                <input
                  value={branch.label}
                  placeholder="declined"
                  onChange={(event) =>
                    edit({
                      branches: node.branches.map((b, i) =>
                        i === at ? { ...b, label: event.target.value } : b,
                      ),
                    })
                  }
                />
                <input
                  value={branch.when}
                  placeholder="the card was declined"
                  onChange={(event) =>
                    edit({
                      branches: node.branches.map((b, i) =>
                        i === at ? { ...b, when: event.target.value } : b,
                      ),
                    })
                  }
                />
                <button
                  className="btn subtle icon"
                  title="Remove this outcome"
                  onClick={() => edit({ branches: node.branches.filter((_, i) => i !== at) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="btn small"
              onClick={() => edit({ branches: [...node.branches, { label: '', when: '' }] })}
            >
              + Outcome
            </button>
          </div>
        </>
      ) : null}

      <label>
        What they said
        <textarea
          rows={3}
          value={node.note}
          onChange={(event) => edit({ note: event.target.value })}
          placeholder="Kept verbatim, for whoever picks this up afterwards"
        />
      </label>

      <div className="client-inspector-order">
        <span className="label">
          Step {index + 1} of {ordered.length}
        </span>
        <button className="btn small" disabled={index <= 0} onClick={() => move(index - 1)}>
          Move earlier
        </button>
        <button
          className="btn small"
          disabled={index >= ordered.length - 1}
          onClick={() => move(index + 1)}
        >
          Move later
        </button>
      </div>

      <p className="hint">
        {node.orphaned
          ? 'The block this stood for has been deleted from the technical diagram.'
          : node.blockId
            ? 'This stands for a block in the technical diagram.'
            : 'Added here. It reaches the technical diagram when the changes below are applied.'}
      </p>

      <div className="client-inspector-actions">
        {node.blockId ? (
          <button
            className="btn small"
            onClick={() => {
              store.setView('diagram');
              if (node.blockId) store.select([node.blockId]);
            }}
          >
            Show on the diagram
          </button>
        ) : null}
        <button
          className="btn small danger"
          onClick={() => store.clientEdit([{ op: 'remove_node', node: node.id }])}
        >
          Remove
        </button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * What is out of step
 * ------------------------------------------------------------------ */

function ChangeStrip({ changes }: { changes: ClientViewDiff }) {
  const [open, setOpen] = useState(false);
  const count =
    changes.addedNodes.length +
    changes.reworded.length +
    changes.addedEdges.length +
    changes.removed.length;

  if (!count && !changes.missing.length && !changes.orphaned.length) {
    return (
      <footer className="client-strip quiet">
        <span>The client view and the technical diagram agree.</span>
      </footer>
    );
  }

  return (
    <footer className="client-strip">
      <button className="btn subtle small" onClick={() => setOpen((value) => !value)}>
        {open ? '▾' : '▸'}
      </button>
      <span>
        {count
          ? `${count} change${count === 1 ? ' from this review is' : 's from this review are'} not in the technical diagram yet.`
          : 'The technical diagram has moved on.'}
        {changes.missing.length
          ? ` ${changes.missing.length} block${changes.missing.length === 1 ? '' : 's'} in the diagram are not shown here.`
          : ''}
      </span>

      <div className="toolbar-spacer" />

      {changes.missing.length ? (
        <button className="btn small" onClick={() => store.syncClientView()}>
          Bring them in
        </button>
      ) : null}
      {count ? (
        <button
          className="btn small primary"
          onClick={() => store.applyClientView(false)}
          title="Add the new boxes and rewordings to the technical diagram. Ask Claude to fill in the detail afterwards."
        >
          Apply to the diagram
        </button>
      ) : null}

      {open ? (
        <ul className="client-strip-list">
          {changes.addedNodes.map((node) => (
            <li key={node.id}>
              <span className="client-mark new">new</span> {node.name} ({clientWordFor(node.type)})
            </li>
          ))}
          {changes.reworded.map((change) => (
            <li key={change.blockId}>
              <span className="client-mark reworded">reworded</span> {change.from} → {change.to}
            </li>
          ))}
          {changes.addedEdges.map((edge) => (
            <li key={edge.id}>
              <span className="client-mark new">new</span> connection
              {edge.condition ? ` (if ${edge.condition})` : ''}
            </li>
          ))}
          {changes.removed.map((removal, at) => (
            <li key={`${removal.blockId}${at}`}>
              <span className="client-mark gone">removed</span> {removal.name}
              {' — '}
              <button className="link" onClick={() => store.applyClientView(true)}>
                delete it from the diagram too
              </button>
            </li>
          ))}
          {changes.orphaned.map((node) => (
            <li key={node.id}>
              <span className="client-mark gone">gone</span> {node.name} no longer exists in the
              diagram
            </li>
          ))}
          {changes.reordered.length ? (
            <li>
              <span className="client-mark reworded">order</span> the client walks through it as:{' '}
              {changes.reordered.join(' → ')}
            </li>
          ) : null}
        </ul>
      ) : null}
    </footer>
  );
}

/* ------------------------------------------------------------------ *
 * The list, and the full window
 * ------------------------------------------------------------------ */

/** The same view as an indented list — what you copy into an email. */
function ClientList() {
  const { current, treeOptions } = useEditorState();
  const tree = useProjectTree(current, treeOptions);
  if (!tree) return null;
  return (
    <div className="client-list">
      <div className="client-list-actions">
        <TreeActions tree={tree} />
      </div>
      <ProjectTreeView tree={tree} showVia={treeOptions.audience === 'technical'} />
    </div>
  );
}

/**
 * Presentation mode. Escape leaves, which is the only control worth learning
 * for something you open in front of somebody else.
 */
export function ClientPresentation() {
  const { current, presenting } = useEditorState();
  const view = store.clientView();

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') store.present(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting]);

  if (!presenting || !current || !view) return null;

  return (
    <div className="present">
      <header>
        <div>
          <h1>{current.name}</h1>
          {current.description || current.projectGoal ? (
            <p>{current.description || current.projectGoal}</p>
          ) : null}
        </div>
        <div className="toolbar-spacer" />
        <TreeControls compact />
        <button className="btn" onClick={() => store.present(false)} title="Escape also closes this">
          Close
        </button>
      </header>
      <div className="present-body canvas">
        <ClientCanvas view={view} presenting />
      </div>
    </div>
  );
}
