import { DesignCanvas } from './DesignCanvas';
import { DesignInspector } from './DesignInspector';
import { DesignLayers } from './DesignLayers';
import { DesignTokens } from './DesignTokens';
import { store, useEditorState } from '../store';

/**
 * The design tab.
 *
 * The third document, filling the workspace like the other two. Layers and the
 * palette on the left, artboards in the middle, properties on the right, and a
 * strip along the bottom saying what the diagram has that the designs do not —
 * the same shape as the client view, because it answers the same question
 * about a different document.
 */

export function DesignView() {
  const { design, designLoading, designPanel, designChanges, designProgress, designSaved } =
    useEditorState();

  if (!design) {
    return (
      <div className="empty">
        <div className="inner">
          {designLoading ? (
            <p>Loading the designs…</p>
          ) : (
            <>
              <h2>Nothing designed yet</h2>
              <p>Open a diagram to design its screens.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const screen = store.currentScreen();
  const element = store.currentElement();

  return (
    <div className="design-view">
      <header className="design-bar">
        <div className="seg" role="group" aria-label="Which panel">
          <button
            className={`btn small${designPanel === 'layers' ? ' primary' : ''}`}
            onClick={() => store.setDesignPanel('layers')}
            title="What is on the screen, and what you can add"
          >
            Layers
          </button>
          <button
            className={`btn small${designPanel === 'tokens' ? ' primary' : ''}`}
            onClick={() => store.setDesignPanel('tokens')}
            title="The colours, type and spacing every screen is drawn against"
          >
            Design system
          </button>
        </div>

        <span className="design-count">
          {design.screens.length} screen{design.screens.length === 1 ? '' : 's'}
          {designProgress ? ` · ${designProgress.completion}% designed` : ''}
          {designSaved ? '' : ' · not saved yet'}
        </span>

        <div className="toolbar-spacer" />

        <button
          className="btn small"
          onClick={() => store.tidyDesign()}
          title="Lay the artboards out in a grid"
          disabled={!design.screens.length}
        >
          Tidy up
        </button>
        <button
          className="btn small"
          onClick={() => void store.syncDesign()}
          title="Give every screen in the diagram a design, keeping what is already drawn"
          disabled={designLoading}
        >
          Update from diagram
        </button>
      </header>

      <div className="design-body">
        <div className="design-side">
          {designPanel === 'layers' ? (
            <DesignLayers screen={screen} />
          ) : (
            <DesignTokens system={design.system} />
          )}
        </div>

        {design.screens.length ? (
          <DesignCanvas design={design} />
        ) : (
          <EmptyDesign loading={designLoading} />
        )}

        <DesignInspector design={design} screen={screen} element={element} />
      </div>

      {designChanges ? <DesignStrip /> : null}
    </div>
  );
}

function EmptyDesign({ loading }: { loading: boolean }) {
  const { current } = useEditorState();
  const screens = (current?.blocks ?? []).filter(
    (block) => block.type === 'ui_screen' || block.type === 'ui_component',
  ).length;

  return (
    <div className="empty">
      <div className="inner">
        <h2>No screens designed yet</h2>
        {screens ? (
          <>
            <p>
              This diagram has {screens} screen{screens === 1 ? '' : 's'}. Seed a wireframe for each
              from what the diagram already knows — its route, the state it holds, the endpoints its
              buttons call — and refine them from there.
            </p>
            <button
              className="btn primary"
              disabled={loading}
              onClick={() => void store.syncDesign()}
            >
              Design the screens
            </button>
          </>
        ) : (
          <>
            <p>
              There are no screens in this diagram yet. Add a <code>ui_screen</code> block on the
              diagram tab, and it can be designed here.
            </p>
            <p>
              Or ask Claude Code: <code>design the screens for this project</code> — it draws them
              through the same tools this editor uses.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * What is out of step
 * ------------------------------------------------------------------ */

/**
 * The strip along the bottom.
 *
 * Two different kinds of gap live here: screens in the diagram that nobody has
 * designed, and holes in the designs themselves — a button that does nothing,
 * a field with nowhere to put its value. The second kind matters because those
 * are exactly the places an implementer would otherwise have to guess.
 */
function DesignStrip() {
  const { designChanges: changes, designProgress: progress } = useEditorState();
  if (!changes || !progress) return <></>;

  const holes = progress.danglingActions.length + progress.unboundFields.length;

  if (!changes.undesigned.length && !changes.orphaned.length && !holes) {
    return (
      <footer className="design-strip quiet">
        <span>Every screen in the diagram has a design, and nothing is left dangling.</span>
      </footer>
    );
  }

  return (
    <footer className="design-strip">
      <span>
        {changes.undesigned.length
          ? `${changes.undesigned.length} screen${changes.undesigned.length === 1 ? '' : 's'} in the diagram ${changes.undesigned.length === 1 ? 'has' : 'have'} no design: ${changes.undesigned.map((b) => b.name).join(', ')}.`
          : ''}
        {changes.orphaned.length
          ? ` ${changes.orphaned.length} design${changes.orphaned.length === 1 ? '' : 's'} no longer ${changes.orphaned.length === 1 ? 'has a' : 'have'} block in the diagram.`
          : ''}
        {holes
          ? ` ${progress.danglingActions.length} button${progress.danglingActions.length === 1 ? '' : 's'} with nothing to do, ${progress.unboundFields.length} field${progress.unboundFields.length === 1 ? '' : 's'} with no binding.`
          : ''}
      </span>

      <div className="toolbar-spacer" />

      {changes.undesigned.length ? (
        <button
          className="btn small primary"
          onClick={() => void store.syncDesign()}
          title="Seed a wireframe for each, from what the diagram already says"
        >
          Design them
        </button>
      ) : null}

      {holes ? (
        <button
          className="btn small"
          title={[
            ...progress.danglingActions.map((d) => `${d.screen} → ${d.element} does nothing`),
            ...progress.unboundFields.map((d) => `${d.screen} → ${d.element} has no binding`),
          ]
            .slice(0, 12)
            .join('\n')}
          onClick={() => {
            const first = progress.danglingActions[0] ?? progress.unboundFields[0];
            if (!first) return;
            const design = store.getState().design;
            const screen = design?.screens.find((s) => s.name === first.screen);
            if (screen) store.selectScreen(screen.id);
          }}
        >
          Show me
        </button>
      ) : null}
    </footer>
  );
}
