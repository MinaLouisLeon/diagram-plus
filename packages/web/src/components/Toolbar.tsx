import { diagramStats } from '@diagram-plus/core/browser';
import { isDesktop, project, useProject } from '../desktop';
import { store, useEditorState } from '../store';

/** The top bar: what diagram you are on, its state, and the global actions. */

interface ToolbarProps {
  onNewDiagram: () => void;
  /** Desktop only — opens the MCP settings screen. */
  onOpenSettings?: () => void;
}

export function Toolbar({ onNewDiagram, onOpenSettings }: ToolbarProps) {
  const { current, connection, saving, panel, canUndo, canRedo, validation } = useEditorState();
  const { root } = useProject();
  const stats = current ? diagramStats(current) : null;
  const errorCount = validation?.errors.length ?? 0;
  const warningCount = validation?.warnings.length ?? 0;
  const desktop = isDesktop();

  return (
    <div className="toolbar">
      <div className="brand">
        diagram<span style={{ color: 'var(--accent)' }}>+</span>
      </div>

      {desktop && root ? (
        <button
          className="btn subtle project-switch"
          onClick={() => void project.pick()}
          title={`${root}\n\nClick to open a different project`}
        >
          {root.replace(/^.*[\\/]/, '') || root}
          <span aria-hidden="true">▾</span>
        </button>
      ) : null}

      {current ? (
        <>
          <div className="toolbar-title">
            <strong>{current.name}</strong>
            <span>
              {stats?.blocks ?? 0} blocks · {stats?.edges ?? 0} connections
              {stats && stats.completion > 0 ? ` · ${stats.completion}% built` : ''}
            </span>
          </div>
          <span className={`pill ${current.status}`}>{current.status}</span>
        </>
      ) : null}

      <div className="toolbar-spacer" />

      {current ? (
        <>
          <button className="btn subtle icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void store.undo()}>
            ↶
          </button>
          <button className="btn subtle icon" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => void store.redo()}>
            ↷
          </button>
          <button className="btn" title="Arrange blocks by dependency" onClick={() => void store.runLayout('LR')}>
            Tidy up
          </button>
          <button
            className={`btn${panel === 'validation' ? ' primary' : ''}`}
            onClick={() => store.setPanel('validation')}
            title="Show design problems"
          >
            Checks
            {errorCount + warningCount > 0 ? (
              <span style={{ color: errorCount ? 'var(--danger)' : 'var(--warning)' }}>
                {errorCount + warningCount}
              </span>
            ) : null}
          </button>
          <button
            className={`btn${panel === 'progress' ? ' primary' : ''}`}
            onClick={() => store.setPanel('progress')}
            title="Build order and what has been implemented"
          >
            Progress
            {stats && stats.completion > 0 ? <span>{stats.completion}%</span> : null}
          </button>
          <button
            className={`btn${panel === 'spec' ? ' primary' : ''}`}
            onClick={() => store.setPanel('spec')}
            title="Preview what Claude will read"
          >
            Spec
          </button>
          <button
            className="btn primary"
            onClick={() =>
              void store.patchMeta({ status: current.status === 'ready' ? 'draft' : 'ready' })
            }
            title={
              current.status === 'ready'
                ? 'Move back to draft while you keep editing'
                : 'Freeze this design so Claude can build from it'
            }
          >
            {current.status === 'ready' ? 'Back to draft' : 'Mark ready'}
          </button>
        </>
      ) : (
        <button className="btn primary" onClick={onNewDiagram}>
          + New diagram
        </button>
      )}

      {desktop && onOpenSettings ? (
        <button
          className="btn subtle icon"
          onClick={onOpenSettings}
          title="Connect your AI tools to diagram-plus"
        >
          ⚙
        </button>
      ) : null}

      <span
        className={`status-dot ${connection}`}
        title={
          connection === 'open'
            ? saving
              ? 'Saving…'
              : 'Live — changes save automatically'
            : `Connection ${connection}`
        }
      />
    </div>
  );
}
