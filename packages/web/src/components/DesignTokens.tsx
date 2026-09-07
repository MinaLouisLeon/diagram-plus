import type { DesignSystem } from '@diagram-plus/core/browser';
import { store } from '../store';

/**
 * The design system, as an editable panel.
 *
 * Every screen refers to these by name, so a change here restyles the whole
 * project at once — which is the entire reason designs point at tokens
 * instead of at colours. It is also the first thing Claude should set, and
 * `set_design_system` writes exactly what this panel edits.
 */

export function DesignTokens({ system }: { system: DesignSystem }) {
  const set = (patch: Partial<DesignSystem>): void =>
    store.designEdit([{ op: 'set_system', system: patch }]);

  return (
    <div className="design-tokens">
      <div className="design-panel-head">
        <span className="label">Design system</span>
      </div>

      <label>
        The feel of it
        <textarea
          rows={3}
          value={system.voice}
          placeholder="Calm and editorial. Generous whitespace, one accent colour."
          onChange={(event) => set({ voice: event.target.value })}
        />
      </label>

      <div className="design-section">
        <span className="label">Colours</span>
        {system.colors.map((token, at) => (
          <div key={at} className="design-token-row">
            <input
              className="design-token-name"
              value={token.name}
              onChange={(event) =>
                set({
                  colors: system.colors.map((c, i) =>
                    i === at ? { ...c, name: event.target.value } : c,
                  ),
                })
              }
            />
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(token.value) ? token.value : '#000000'}
              onChange={(event) =>
                set({
                  colors: system.colors.map((c, i) =>
                    i === at ? { ...c, value: event.target.value } : c,
                  ),
                })
              }
            />
            <input
              className="design-token-value"
              value={token.value}
              onChange={(event) =>
                set({
                  colors: system.colors.map((c, i) =>
                    i === at ? { ...c, value: event.target.value } : c,
                  ),
                })
              }
            />
            <button
              className="btn subtle icon"
              title={`Remove ${token.name}`}
              onClick={() => set({ colors: system.colors.filter((_, i) => i !== at) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn small"
          onClick={() =>
            set({
              colors: [...system.colors, { name: 'new', value: '#888888', on: '', description: '' }],
            })
          }
        >
          + Colour
        </button>
      </div>

      <div className="design-section">
        <span className="label">Type scale</span>
        {system.typography.map((token, at) => (
          <div key={at} className="design-token-row type">
            <input
              className="design-token-name"
              value={token.name}
              onChange={(event) =>
                set({
                  typography: system.typography.map((t, i) =>
                    i === at ? { ...t, name: event.target.value } : t,
                  ),
                })
              }
            />
            <input
              type="number"
              title="Size in pixels"
              value={token.size}
              onChange={(event) =>
                set({
                  typography: system.typography.map((t, i) =>
                    i === at ? { ...t, size: Number(event.target.value) } : t,
                  ),
                })
              }
            />
            <input
              type="number"
              step={100}
              min={100}
              max={900}
              title="Weight"
              value={token.weight}
              onChange={(event) =>
                set({
                  typography: system.typography.map((t, i) =>
                    i === at ? { ...t, weight: Number(event.target.value) } : t,
                  ),
                })
              }
            />
            <span
              className="design-token-sample"
              style={{ fontSize: Math.min(token.size, 20), fontWeight: token.weight }}
              title={token.description}
            >
              Ag
            </span>
            <button
              className="btn subtle icon"
              title={`Remove ${token.name}`}
              onClick={() => set({ typography: system.typography.filter((_, i) => i !== at) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="btn small"
          onClick={() =>
            set({
              typography: [
                ...system.typography,
                {
                  name: 'new',
                  family: '',
                  size: 16,
                  weight: 400,
                  lineHeight: 1.5,
                  letterSpacing: 0,
                  transform: 'none',
                  description: '',
                },
              ],
            })
          }
        >
          + Type
        </button>
      </div>

      <div className="design-section">
        <span className="label">Spacing and shape</span>
        <label>
          Base spacing step
          <input
            type="number"
            min={1}
            value={system.spacingBase}
            onChange={(event) => set({ spacingBase: Number(event.target.value) })}
          />
        </label>
        {system.radii.map((token, at) => (
          <div key={at} className="design-token-row">
            <input
              className="design-token-name"
              value={token.name}
              onChange={(event) =>
                set({
                  radii: system.radii.map((r, i) =>
                    i === at ? { ...r, name: event.target.value } : r,
                  ),
                })
              }
            />
            <input
              className="design-token-value"
              value={token.value}
              onChange={(event) =>
                set({
                  radii: system.radii.map((r, i) =>
                    i === at ? { ...r, value: event.target.value } : r,
                  ),
                })
              }
            />
            <button
              className="btn subtle icon"
              onClick={() => set({ radii: system.radii.filter((_, i) => i !== at) })}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <label>
        Notes for whoever builds it
        <textarea
          rows={3}
          value={system.notes}
          placeholder="Icon set, motion, grid — anything the tokens do not cover"
          onChange={(event) => set({ notes: event.target.value })}
        />
      </label>

      <p className="hint">
        Screens refer to these by name, so changing one restyles every artboard at once. Ask Claude
        to set them all in one go with <code>set_design_system</code>.
      </p>
    </div>
  );
}
