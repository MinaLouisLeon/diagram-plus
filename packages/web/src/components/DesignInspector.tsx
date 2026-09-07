import {
  DEVICE_FRAMES,
  ELEMENT_CATALOG,
  ELEMENT_CATEGORIES,
  ELEMENT_TYPES,
  elementLabel,
  type DesignDocument,
  type DesignElement,
  type Device,
  type ElementProp,
  type ElementType,
  type ScreenDesign,
  type Sizing,
} from '@diagram-plus/core/browser';
import { store, useEditorState } from '../store';

/**
 * The properties panel.
 *
 * It shows only what the selected element actually uses — a divider has no
 * placeholder, a checkbox has no columns — because a form of forty fields
 * where thirty do nothing is how a designer learns to stop reading the panel.
 * The catalog decides which apply; this only renders them.
 *
 * With nothing selected it falls back to the artboard, since "what screen am I
 * on and what is it for" is the other question this corner has to answer.
 */

export function DesignInspector({
  design,
  screen,
  element,
}: {
  design: DesignDocument;
  screen: ScreenDesign | null;
  element: DesignElement | null;
}) {
  if (!screen) return null;
  return (
    <aside className="design-inspector">
      {element && element.id !== screen.root.id ? (
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
  element: DesignElement | null;
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

function ElementForm({
  design,
  screen,
  element,
}: {
  design: DesignDocument;
  screen: ScreenDesign;
  element: DesignElement;
}) {
  const { current } = useEditorState();
  const info = ELEMENT_CATALOG[element.type];
  const uses = new Set<ElementProp>(info.props);

  const edit = (patch: Record<string, unknown>): void =>
    store.designEdit([
      { op: 'update_element', screen: screen.id, element: element.id, ...patch } as never,
    ]);

  const screens = current?.blocks.filter((b) => b.type === 'ui_screen') ?? [];
  const endpoints = current?.blocks.filter(
    (b) => b.type === 'api_endpoint' || b.type === 'service' || b.type === 'external_service',
  ) ?? [];

  return (
    <>
      <div className="design-inspector-head">
        <strong>{elementLabel(element.type, element.name, element.text)}</strong>
        <span className="design-node-kind">{info.label}</span>
        <button
          className="btn subtle icon"
          onClick={() => store.selectElement(null)}
          title="Back to the artboard"
        >
          ×
        </button>
      </div>

      <label>
        What it is
        <select
          value={element.type}
          onChange={(event) => edit({ type: event.target.value as ElementType })}
          title={info.whenToUse}
        >
          {ELEMENT_CATEGORIES.map((category) => (
            <optgroup key={category.id} label={category.label}>
              {ELEMENT_TYPES.filter((type) => ELEMENT_CATALOG[type].category === category.id).map(
                (type) => (
                  <option key={type} value={type}>
                    {ELEMENT_CATALOG[type].label}
                  </option>
                ),
              )}
            </optgroup>
          ))}
        </select>
      </label>

      <label>
        Layer name
        <input
          value={element.name}
          placeholder={info.label}
          onChange={(event) => edit({ name: event.target.value })}
        />
      </label>

      {/* ---- what it says ---- */}
      {uses.has('text') ? (
        <label>
          Text
          <textarea
            rows={2}
            value={element.text}
            placeholder="The real words, not a placeholder"
            onChange={(event) => edit({ text: event.target.value })}
          />
        </label>
      ) : null}

      {uses.has('label') ? (
        <label>
          Label
          <input value={element.label} onChange={(event) => edit({ label: event.target.value })} />
        </label>
      ) : null}

      {uses.has('placeholder') ? (
        <label>
          Placeholder
          <input
            value={element.placeholder}
            onChange={(event) => edit({ placeholder: event.target.value })}
          />
        </label>
      ) : null}

      {uses.has('helper') ? (
        <label>
          Helper line
          <input value={element.helper} onChange={(event) => edit({ helper: event.target.value })} />
        </label>
      ) : null}

      {uses.has('variant') ? (
        <label>
          Emphasis
          <input
            value={element.variant}
            placeholder="primary, secondary, ghost, danger…"
            onChange={(event) => edit({ variant: event.target.value })}
          />
        </label>
      ) : null}

      {uses.has('icon') ? (
        <label>
          Icon
          <input
            value={element.icon}
            placeholder="An emoji, or an icon name"
            onChange={(event) => edit({ icon: event.target.value })}
          />
        </label>
      ) : null}

      {uses.has('src') ? (
        <label>
          What it shows
          <input
            value={element.src}
            placeholder="Described, never a file"
            onChange={(event) => edit({ src: event.target.value })}
          />
        </label>
      ) : null}

      {uses.has('columns') ? (
        <label>
          Columns
          <input
            value={element.columns.join(', ')}
            placeholder="Name, Status, Updated"
            onChange={(event) =>
              edit({
                columns: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      ) : null}

      {uses.has('options') ? <Options element={element} onChange={edit} /> : null}

      {uses.has('repeat') ? (
        <div className="design-row">
          <label>
            Repeats over
            <input
              value={element.repeat?.over ?? ''}
              placeholder="A data model, or plain words"
              onChange={(event) =>
                edit({ repeat: { over: event.target.value, count: element.repeat?.count ?? 3 } })
              }
            />
          </label>
          <label>
            Show
            <input
              type="number"
              min={1}
              max={24}
              value={element.repeat?.count ?? 3}
              onChange={(event) =>
                edit({ repeat: { over: element.repeat?.over ?? '', count: Number(event.target.value) } })
              }
            />
          </label>
        </div>
      ) : null}

      {/* ---- what it means ---- */}
      <div className="design-section">
        <span className="label">What it means</span>

        {uses.has('binding') ? (
          <label>
            Value comes from
            <input
              value={element.binding}
              placeholder="state.email, or Order.total"
              onChange={(event) => edit({ binding: event.target.value })}
              list="design-bindings"
            />
          </label>
        ) : null}

        {uses.has('action') ? (
          <label>
            Using it does
            <input
              value={element.action}
              placeholder="POST /api/session, or the service it reaches"
              onChange={(event) => edit({ action: event.target.value })}
              list="design-actions"
            />
          </label>
        ) : null}

        {uses.has('navigatesTo') ? (
          <label>
            Goes to
            <select
              value={element.navigatesTo}
              onChange={(event) => edit({ navigatesTo: event.target.value })}
            >
              <option value="">Nowhere</option>
              {screens.map((block) => (
                <option key={block.id} value={block.name}>
                  {block.name}
                </option>
              ))}
              {element.navigatesTo && !screens.some((b) => b.name === element.navigatesTo) ? (
                <option value={element.navigatesTo}>{element.navigatesTo}</option>
              ) : null}
            </select>
          </label>
        ) : null}

        {uses.has('componentId') ? (
          <label>
            Component
            <select
              value={element.componentId}
              onChange={(event) => edit({ componentId: event.target.value })}
            >
              <option value="">Not chosen</option>
              {(current?.blocks ?? [])
                .filter((b) => b.type === 'ui_component')
                .map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        <label>
          Only shown when
          <input
            value={element.visibleWhen}
            placeholder="the basket is empty"
            onChange={(event) => edit({ visibleWhen: event.target.value })}
          />
        </label>

        <div className="design-checks">
          {uses.has('required') ? (
            <label className="check">
              <input
                type="checkbox"
                checked={element.required}
                onChange={(event) => edit({ required: event.target.checked })}
              />
              Required
            </label>
          ) : null}
          {uses.has('disabled') ? (
            <label className="check">
              <input
                type="checkbox"
                checked={element.disabled}
                onChange={(event) => edit({ disabled: event.target.checked })}
              />
              Disabled
            </label>
          ) : null}
          <label className="check">
            <input
              type="checkbox"
              checked={element.hidden}
              onChange={(event) => edit({ hidden: event.target.checked })}
            />
            Hidden
          </label>
        </div>
      </div>

      <Layout element={element} onChange={edit} />
      <Style element={element} design={design} onChange={edit} />

      <label>
        Notes
        <textarea
          rows={2}
          value={element.notes}
          placeholder="Anything the tree cannot say"
          onChange={(event) => edit({ notes: event.target.value })}
        />
      </label>

      <div className="design-inspector-actions">
        <button
          className="btn small"
          onClick={() =>
            store.designEdit([
              { op: 'duplicate_element', screen: screen.id, element: element.id },
            ])
          }
        >
          Duplicate
        </button>
        <button
          className="btn small danger"
          onClick={() =>
            store.designEdit([{ op: 'remove_element', screen: screen.id, element: element.id }])
          }
        >
          Remove
        </button>
      </div>

      {/* Suggestions drawn from the diagram, so a binding or an action is
          usually one keystroke rather than a remembered string. */}
      <datalist id="design-bindings">
        {(current?.blocks ?? [])
          .filter((b) => b.type === 'data_model')
          .flatMap((b) =>
            (b.data as { fields?: { name: string }[] }).fields?.map(
              (field) => `${b.name}.${field.name}`,
            ) ?? [],
          )
          .map((value) => (
            <option key={value} value={value} />
          ))}
      </datalist>
      <datalist id="design-actions">
        {endpoints.map((b) => (
          <option key={b.id} value={b.name} />
        ))}
      </datalist>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Sub-forms
 * ------------------------------------------------------------------ */

function Options({
  element,
  onChange,
}: {
  element: DesignElement;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="design-options">
      <span className="label">Options</span>
      {element.options.map((option, at) => (
        <div key={at} className="design-option-row">
          <input
            value={option.label}
            placeholder="Label"
            onChange={(event) =>
              onChange({
                options: element.options.map((o, i) =>
                  i === at ? { ...o, label: event.target.value } : o,
                ),
              })
            }
          />
          <label className="check" title="Shown as the chosen one">
            <input
              type="checkbox"
              checked={option.selected}
              onChange={(event) =>
                onChange({
                  options: element.options.map((o, i) => ({
                    ...o,
                    selected: i === at ? event.target.checked : false,
                  })),
                })
              }
            />
          </label>
          <button
            className="btn subtle icon"
            title="Remove"
            onClick={() => onChange({ options: element.options.filter((_, i) => i !== at) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn small"
        onClick={() =>
          onChange({ options: [...element.options, { label: '', value: '', selected: false }] })
        }
      >
        + Option
      </button>
    </div>
  );
}

/** "fill" / "hug" / a number, as one control. */
function SizeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Sizing;
  onChange: (next: Sizing) => void;
}) {
  const mode = typeof value === 'number' ? 'fixed' : value;
  return (
    <label>
      {label}
      <div className="design-size">
        <select
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next === 'fixed' ? (typeof value === 'number' ? value : 200) : (next as Sizing));
          }}
        >
          <option value="fill">Fill</option>
          <option value="hug">Hug</option>
          <option value="fixed">Fixed</option>
        </select>
        {typeof value === 'number' ? (
          <input
            type="number"
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        ) : null}
      </div>
    </label>
  );
}

function Layout({
  element,
  onChange,
}: {
  element: DesignElement;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { layout } = element;
  const container = ELEMENT_CATALOG[element.type].container;
  const set = (patch: Record<string, unknown>): void => onChange({ layout: patch });
  const pad = layout.padding;

  return (
    <div className="design-section">
      <span className="label">Layout</span>

      <div className="design-row">
        <SizeField label="Width" value={layout.width} onChange={(width) => set({ width })} />
        <SizeField label="Height" value={layout.height} onChange={(height) => set({ height })} />
      </div>

      {container ? (
        <>
          <div className="design-row">
            <label>
              Direction
              <select
                value={layout.direction}
                onChange={(event) => set({ direction: event.target.value })}
              >
                <option value="column">Column</option>
                <option value="row">Row</option>
              </select>
            </label>
            <label>
              Gap
              <input
                type="number"
                min={0}
                value={layout.gap}
                onChange={(event) => set({ gap: Number(event.target.value) })}
              />
            </label>
            {element.type === 'grid' ? (
              <label>
                Columns
                <input
                  type="number"
                  min={0}
                  value={layout.columns}
                  onChange={(event) => set({ columns: Number(event.target.value) })}
                />
              </label>
            ) : null}
          </div>

          <div className="design-row">
            <label>
              Along
              <select
                value={layout.justify}
                onChange={(event) => set({ justify: event.target.value })}
              >
                {['start', 'center', 'end', 'between', 'around', 'evenly'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Across
              <select value={layout.align} onChange={(event) => set({ align: event.target.value })}>
                {['stretch', 'start', 'center', 'end', 'baseline'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}

      <div className="design-row">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <label key={side}>
            {side === 'top' ? 'Padding ↑' : side === 'right' ? '→' : side === 'bottom' ? '↓' : '←'}
            <input
              type="number"
              min={0}
              value={pad[side]}
              onChange={(event) =>
                set({ padding: { ...pad, [side]: Number(event.target.value) } })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function Style({
  element,
  design,
  onChange,
}: {
  element: DesignElement;
  design: DesignDocument;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { style } = element;
  const set = (patch: Record<string, unknown>): void => onChange({ style: patch });
  const { system } = design;

  /** A picker over the tokens of one kind, keeping whatever was typed by hand. */
  const tokenSelect = (label: string, value: string, names: string[], key: string) => (
    <label>
      {label}
      <select value={names.includes(value) ? value : ''} onChange={(event) => set({ [key]: event.target.value })}>
        <option value="">—</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        {value && !names.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
    </label>
  );

  const colors = system.colors.map((c) => c.name);

  return (
    <div className="design-section">
      <span className="label">Look</span>

      <div className="design-row">
        {tokenSelect('Type', style.text, system.typography.map((t) => t.name), 'text')}
        {tokenSelect('Colour', style.color, colors, 'color')}
      </div>

      <div className="design-row">
        {tokenSelect('Fill', style.background, colors, 'background')}
        {tokenSelect('Radius', style.radius, system.radii.map((r) => r.name), 'radius')}
      </div>

      <div className="design-row">
        {tokenSelect('Border', style.border, colors, 'border')}
        <label>
          Width
          <input
            type="number"
            min={0}
            value={style.borderWidth}
            onChange={(event) => set({ borderWidth: Number(event.target.value) })}
          />
        </label>
        {tokenSelect('Shadow', style.shadow, system.shadows.map((s) => s.name), 'shadow')}
      </div>

      <div className="design-row">
        <label>
          Text sits
          <select value={style.align} onChange={(event) => set({ align: event.target.value })}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>
    </div>
  );
}
