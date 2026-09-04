import { useCallback, useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { BottomPanel } from './components/Panels';
import { NewDiagramDialog } from './components/NewDiagramDialog';
import { store, useEditorState } from './store';

/**
 * The shell. Routing is one path deep — `/d/<slug>` opens a diagram — so it is
 * handled here rather than pulled in as a dependency.
 */

function slugFromLocation(): string | null {
  const match = /^\/d\/([^/?#]+)/.exec(location.pathname);
  return match?.[1] ?? null;
}

export function App() {
  const state = useEditorState();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void store.init();
    return () => store.dispose();
  }, []);

  // Open whatever the URL points at, and keep the URL in step with the app.
  useEffect(() => {
    const slug = slugFromLocation();
    if (slug) void store.open(slug);
    const onPop = () => {
      const next = slugFromLocation();
      if (next) void store.open(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!state.current) return;
    const target = `/d/${state.current.slug}`;
    if (location.pathname !== target) history.replaceState(null, '', target);
  }, [state.current?.slug]);

  // Save anything still queued before the tab goes away.
  useEffect(() => {
    const flush = () => void store.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        void (event.shiftKey ? store.redo() : store.undo());
      }
      if (key === 's') {
        event.preventDefault();
        void store.flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openDialog = useCallback(() => setDialogOpen(true), []);

  return (
    <div className="app">
      <Toolbar onNewDiagram={openDialog} />
      <div className={`workspace${state.current ? '' : ' no-inspector'}`}>
        <Sidebar onNewDiagram={openDialog} />
        <div className="canvas-area">
          {state.current ? <Canvas /> : <EmptyState loading={state.loading} onNew={openDialog} />}
          <BottomPanel />
          <Notices />
        </div>
        {state.current ? (
          <aside className="inspector">
            <Inspector />
          </aside>
        ) : null}
      </div>
      {dialogOpen ? <NewDiagramDialog onClose={() => setDialogOpen(false)} /> : null}
    </div>
  );
}

function Notices() {
  const { error, externalEdit } = useEditorState();

  useEffect(() => {
    if (!externalEdit) return;
    const timer = window.setTimeout(() => store.dismissExternalEdit(), 5000);
    return () => window.clearTimeout(timer);
  }, [externalEdit]);

  if (error) {
    return (
      <div className="toast error">
        <span>{error}</span>
        <button className="btn subtle small" onClick={() => store.dismissError()}>
          Dismiss
        </button>
      </div>
    );
  }
  if (externalEdit) {
    return (
      <div className="toast info">
        <span>This diagram was just updated outside the editor — the canvas is up to date.</span>
      </div>
    );
  }
  return null;
}

function EmptyState({ loading, onNew }: { loading: boolean; onNew: () => void }) {
  const { diagrams } = useEditorState();

  if (loading) {
    return (
      <div className="empty">
        <div className="inner">Loading…</div>
      </div>
    );
  }

  return (
    <div className="empty">
      <div className="inner">
        <h2>{diagrams.length ? 'Pick a diagram' : 'Design your project first'}</h2>
        {diagrams.length ? (
          <p>Choose one from the list on the left, or start a new one.</p>
        ) : (
          <>
            <p>
              A diagram-plus diagram is a typed block diagram of an application — screens,
              endpoints, services, data models — that Claude Code can write and then build from.
            </p>
            <p>
              Ask Claude Code: <code>use diagram-plus to design a block diagram for my project</code>
              , then come back here to review and edit it.
            </p>
          </>
        )}
        <button className="btn primary" onClick={onNew}>
          + New diagram
        </button>
      </div>
    </div>
  );
}
