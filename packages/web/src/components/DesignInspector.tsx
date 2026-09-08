import {
  DEVICE_FRAMES,
  type DesignDocument,
  type Device,
  type ElementFacts,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';

/**
 * The properties panel.
 *
 * With an element selected it edits that element; with nothing selected it
 * falls back to the artboard, since "what screen am I on and what is it for"
 * is the other question this corner has to answer.
 *
 * What it no longer does is edit the look. A screen is CSS now, and a panel of
 * dropdowns over a stylesheet would be a worse way to write CSS than writing
 * CSS. What stays here is what markup cannot say on its own: where a value
 * comes from, what pressing something does, where it goes.
 */

export function DesignInspector({
  design,
  screen,
  element,
}: {
  design: DesignDocument;
  screen: ScreenDesign | null;
  element: ElementFacts | null;
}) {
  if (!screen) return null;
  return (
    <aside className="design-inspector">
      {element ? (
        <ElementForm screen={screen} element={element} design={design} />
      ) : (
        <ScreenForm screen={screen} element={element} />
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * The artboard
 * ------------------------------------------------------------------ */

function ScreenForm({
  screen,
  element,
}: {
  screen: ScreenDesign;
  element: ElementFacts | null;
}) {
  const { current } = useEditorState();
  const edit = (patch: Record<string, unknown>): void =>
    store.designEdit([{ op: 'update_screen', screen: screen.id, ...patch } as never]);

  const block = current?.blocks.find((b) => b.id === screen.blockId);

  return (
    <>
      <div className="design-inspector-head">
        <strong>{screen.name}</strong>
        <span className="design-node-kind">artboard</span>
      </div>

      {screen.orphaned ? (
        <p className="hint warn">
          The block this screen designed has been deleted from the diagram. Nothing has been lost —
          re-point it at a block, or remove the artboard.
        </p>
      ) : null}

      <label>
        Name
        <input value={screen.name} onChange={(event) => edit({ name: event.target.value })} />
      </label>

      <label>
        Variant
        <input
          value={screen.variant}
          placeholder="Blank for the main one — Empty, Error…"
          onChange={(event) => edit({ variant: event.target.value })}
        />
      </label>

      <label>
        What it is for
        <textarea
          rows={2}
          value={screen.purpose}
          placeholder="One line, in the words the diagram uses"
          onChange={(event) => edit({ purpose: event.target.value })}
        />
      </label>

      <label>
        Route
        <input
          value={screen.route}
          placeholder="/checkout"
          onChange={(event) => edit({ route: event.target.value })}
        />
      </label>

      <div className="design-row">
        <label>
          Frame
          <select
            value={screen.device}
            onChange={(event) => edit({ device: event.target.value as Device })}
          >
            {(Object.keys(DEVICE_FRAMES) as Device[]).map((device) => (
              <option key={device} value={device}>
                {DEVICE_FRAMES[device].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width
          <input
            type="number"
            value={screen.frame.width}
            onChange={(event) => edit({ frame: { width: Number(event.target.value) } })}
          />
        </label>
        <label>
          Height
          <input
            type="number"
            value={screen.frame.height}
            onChange={(event) => edit({ frame: { height: Number(event.target.value) } })}
          />
        </label>
      </div>

      <label>
        Background
        <input
          value={screen.background}
          placeholder="A colour token, e.g. background"
          onChange={(event) => edit({ background: event.target.value })}
        />
      </label>

      <label>
        How far along
        <select value={screen.status} onChange={(event) => edit({ status: event.target.value })}>
          <option value="todo">Not designed yet</option>
          <option value="drafted">Drafted</option>
          <option value="approved">Approved</option>
        </select>
      </label>

      {/* States are words rather than artboards, because most of them are one
          line — "the button spins" — and drawing each would cost more than it
          told anybody. Ones worth drawing become a variant instead. */}
      <div className="design-states">
        <span className="label">Other states</span>
        {screen.states.map((state, at) => (
          <div key={at} className="design-state-row">
            <input
              value={state.name}
              placeholder="Loading"
              onChange={(event) =>
                edit({
                  states: screen.states.map((s, i) =>
                    i === at ? { ...s, name: event.target.value } : s,
                  ),
                })
              }
            />
            <input
              value={state.when}
              placeholder="while signing in"
              onChange={(event) =>
                edit({
                  states: screen.states.map((s, i) =>
                    i === at ? { ...s, when: event.target.value } : s,
                  ),
                })
              }
            />
            <input
              value={state.changes}
              placeholder="the button shows a spinner"
              onChange={(event) =>
                edit({
                  states: screen.states.map((s, i) =>
                    i === at ? { ...s, changes: event.target.value } : s,
                  ),
                })
              }
            />
            <button
              className="btn subtle icon"
              title="Remove this state"
              onClick={() => edit({ states: screen.states.filter((_, i) => i !== at) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn small"
          onClick={() => edit({ states: [...screen.states, { name: '', when: '', changes: '' }] })}
        >
          + State
        </button>
      </div>

      <label>
        Notes for whoever builds it
        <textarea
          rows={3}
          value={screen.notes}
          onChange={(event) => edit({ notes: event.target.value })}
        />
      </label>

      <p className="hint">
        {block
          ? `This draws the "${block.name}" block. Its route and purpose follow the diagram until you change them here.`
          : 'Added here. It does not stand for a block in the diagram yet.'}
      </p>

      <div className="design-inspector-actions">
        {screen.blockId ? (
          <button
            className="btn small"
            onClick={() => {
              store.setView('diagram');
              if (screen.blockId) store.select([screen.blockId]);
            }}
          >
            Show on the diagram
          </button>
        ) : null}
        <button
          className="btn small"
          onClick={() =>
            store.designEdit([{ op: 'duplicate_screen', screen: screen.id, variant: 'Copy' }])
          }
        >
          Duplicate
        </button>
      </div>
      {element ? null : <p className="hint">Click anything on the artboard to edit it.</p>}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * An element
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The selected element
 * ------------------------------------------------------------------ */

/**
 * What the panel offers for one element.
 *
 * The tree's version of this form was generated from a catalog that knew a
 * checkbox has no `columns` and a divider has no `placeholder`. HTML has no
 * such catalog, so the form is split by what the questions *are* rather than
 * by type: what it says, what it means, and how it looks.
 *
 * The middle section is the one that matters and the one that ports across
 * unchanged — binding, action, destination, all still offered against the
 * diagram's own endpoints, models and screens, because a design that names
 * things the diagram does not have is how a spec goes stale.
 */
function ElementForm({
  design,
  screen,
  element,
}: {
  design: DesignDocument;
  screen: ScreenDesign;
  element: ElementFacts;
}) {
  const { current: diagram } = useEditorState();

  const edit = (name: string, value: string | null): void => {
    store.designEdit([
      { op: 'set_attribute', screen: screen.id, element: element.id, name, value },
    ]);
  };

  const endpoints = (diagram?.blocks ?? [])
    .filter((b) => b.type === 'api_endpoint' || b.type === 'service')
    .map((b) => b.name);
  const screens = (diagram?.blocks ?? []).filter((b) => b.type === 'ui_screen').map((b) => b.name);
  const models = (diagram?.blocks ?? []).filter((b) => b.type === 'data_model').map((b) => b.name);

  const isPressable = element.tag === 'button' || element.tag === 'a';
  const isField = ['input', 'textarea', 'select'].includes(element.tag);

  return (
    <>
      <div className="inspector-head">
        <span className="inspector-title">{element.label}</span>
        <code className="inspector-tag">{element.tag}</code>
      </div>

      <section className="inspector-section">
        <h4>What it says</h4>
        <label className="field">
          <span>TEXT</span>
          <textarea
            rows={2}
            value={element.text}
            placeholder="The words on it"
            onChange={(e) =>
              store.designEdit([
                { op: 'set_text', screen: screen.id, element: element.id, text: e.target.value },
              ])
            }
          />
        </label>
        <label className="field">
          <span>CLASSES</span>
          <input
            value={element.classes.join(' ')}
            placeholder="btn primary"
            onChange={(e) => edit('class', e.target.value || null)}
          />
        </label>
      </section>

      <section className="inspector-section">
        <h4>What it means</h4>
        {isField ? (
          <label className="field">
            <span>VALUE COMES FROM</span>
            <input
              list="dz-bindings"
              value={element.binding}
              placeholder="state.email"
              onChange={(e) => edit('data-binding', e.target.value || null)}
            />
            <datalist id="dz-bindings">
              {models.map((name) => (
                <option key={name} value={`${name}.`} />
              ))}
            </datalist>
          </label>
        ) : null}

        {isPressable ? (
          <>
            <label className="field">
              <span>DOES</span>
              <input
                list="dz-actions"
                value={element.action}
                placeholder="POST /api/session"
                onChange={(e) => edit('data-action', e.target.value || null)}
              />
              <datalist id="dz-actions">
                {endpoints.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>GOES TO</span>
              <select
                value={element.navigatesTo}
                onChange={(e) => edit('data-navigates-to', e.target.value || null)}
              >
                <option value="">Nowhere</option>
                {screens.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <label className="field">
          <span>REPEATS OVER</span>
          <input
            value={element.repeat?.over ?? ''}
            placeholder="Patient"
            onChange={(e) => edit('data-repeat', e.target.value || null)}
          />
        </label>
        <label className="field">
          <span>ONLY WHEN</span>
          <input
            value={element.visibleWhen}
            placeholder="the basket is empty"
            onChange={(e) => edit('data-visible-when', e.target.value || null)}
          />
        </label>

        <div className="inspector-checks">
          <label>
            <input
              type="checkbox"
              checked={element.required}
              onChange={(e) => edit('required', e.target.checked ? '' : null)}
            />{' '}
            Required
          </label>
          <label>
            <input
              type="checkbox"
              checked={element.disabled}
              onChange={(e) => edit('disabled', e.target.checked ? '' : null)}
            />{' '}
            Disabled
          </label>
          <label>
            <input
              type="checkbox"
              checked={element.hidden}
              onChange={(e) => edit('hidden', e.target.checked ? '' : null)}
            />{' '}
            Hidden
          </label>
        </div>
      </section>

      <section className="inspector-section">
        <h4>Notes for whoever builds it</h4>
        <textarea
          rows={2}
          value={design.screens.length ? element.id && '' : ''}
          placeholder="Anything the markup cannot say"
          onChange={(e) => edit('data-note', e.target.value || null)}
        />
      </section>

      <div className="inspector-actions">
        <button
          className="btn subtle small"
          onClick={() =>
            store.designEdit([
              { op: 'duplicate_node', screen: screen.id, element: element.id },
            ])
          }
        >
          Duplicate
        </button>
        <button
          className="btn subtle small danger"
          onClick={() =>
            store.designEdit([{ op: 'remove_node', screen: screen.id, element: element.id }])
          }
        >
          Remove
        </button>
      </div>

      <p className="inspector-hint">
        The look of a screen lives in its CSS, not here. Edit the shared stylesheet in the Design
        system panel, or ask Claude to restyle it.
      </p>
    </>
  );
}
