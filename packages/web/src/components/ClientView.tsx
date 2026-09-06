import { useEffect } from 'react';
import type { TreeFilter } from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';
import { ProjectTreeView, TreeActions, useProjectTree } from './ProjectTreeView';

/**
 * The two places the client view is shown: as a drawer beside the canvas while
 * you tune it, and filling the window when it is time to show someone.
 *
 * Both read the same options out of the store, so the tree you set up in the
 * drawer is the tree that appears when you present it.
 */

/** The knobs, shared by the drawer and the overlay's own header. */
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
          <label className="check" title="How far to follow each flow">
            Depth
            <input
              type="number"
              min={1}
              max={20}
              value={treeOptions.maxDepth ?? 8}
              onChange={(event) =>
                store.setTreeOptions({ maxDepth: Number(event.target.value) || 8 })
              }
              style={{ width: 52 }}
            />
          </label>

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

          <input
            type="search"
            placeholder="Only blocks matching…"
            value={filter.search ?? ''}
            onChange={(event) => store.setTreeFilter({ search: event.target.value })}
            style={{ width: 150 }}
          />
        </>
      )}
    </>
  );
}

/** The drawer, alongside Checks / Progress / Spec. */
export function TreePanel() {
  const { current, treeOptions } = useEditorState();
  const tree = useProjectTree(current, treeOptions);
  if (!current || !tree) return null;

  return (
    <div className="panel">
      <div className="panel-header wrap">
        <strong>Client view</strong>
        <span>{tree.nodeCount} steps</span>
        <TreeControls />
        <div className="toolbar-spacer" />
        <TreeActions tree={tree} />
        <button
          className="btn small primary"
          onClick={() => store.present(true)}
          title="Fill the window — the view to share on a call"
        >
          Present
        </button>
        <button className="btn subtle icon" onClick={() => store.setPanel(null)}>
          ×
        </button>
      </div>
      <div className="panel-body">
        <ProjectTreeView tree={tree} showVia={treeOptions.audience === 'technical'} />
      </div>
    </div>
  );
}

/**
 * Presentation mode. Escape leaves, which is the only control worth learning
 * for something you open in front of somebody else.
 */
export function TreePresentation() {
  const { current, treeOptions, presenting } = useEditorState();
  const tree = useProjectTree(current, treeOptions);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') store.present(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting]);

  if (!presenting || !current || !tree) return null;

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
        <TreeActions tree={tree} />
        <button className="btn" onClick={() => store.present(false)} title="Escape also closes this">
          Close
        </button>
      </header>
      <div className="present-body">
        <ProjectTreeView tree={tree} large />
      </div>
    </div>
  );
}
