import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  cssLength,
  formatInlineStyle,
  parseInlineStyle,
  type DesignDocument,
  type ElementFacts,
  type ScreenDesign,
} from '@diagram-plus/core/browser';
import {
  colorSuggestions,
  fontLabel,
  FONT_STACKS,
  isTransparent,
  radiusSuggestions,
  shadowSuggestions,
  toHex,
  typeClasses,
} from '../design-style';
import { store, type ElementMeasure } from '../store';

/**
 * The look of the selected element.
 *
 * The panel used to refuse this on the grounds that a stylesheet is a better
 * way to write CSS than a wall of dropdowns — which is true of a *screen*, and
 * false of the thing somebody is pointing at. "That heading is too small" is
 * answered by making that heading bigger, and being told to go and write a
 * rule for it is how a design tool loses an argument with a pen.
 *
 * So every field here writes one declaration onto that element and nothing
 * else. Two things keep that from decaying into thirty screens of one-off
 * overrides. Every value that has a token offers the token first, so a colour
 * picked here is still `var(--color-accent)` and still follows the system. And
 * every field shows what the element already resolves to — read off the
 * artboard, not out of the file — so the panel is a picture of the screen
 * rather than a list of exceptions to it, and there is never a reason to
 * override something into the value it already had.
 */

/* ------------------------------------------------------------------ *
 * Writing a declaration
 * ------------------------------------------------------------------ */

/**
 * Commit style changes, without filling the undo stack with a colour drag.
 *
 * A colour picker fires as the pointer moves and a nudged number fires per
 * keystroke. Each is a real edit and has to reach the document, but forty of
 * them are one decision, so a run of changes to the same property inside a
 * second folds into the undo entry the first one opened.
 */
function useStyleWriter(screenId: string, elementId: string) {
  const last = useRef<{ what: string; at: number } | null>(null);

  return useCallback(
    (styles: Record<string, string | null>, options: { replace?: boolean } = {}) => {
      const what = Object.keys(styles).sort().join(',');
      const now = Date.now();
      const run = last.current;
      const coalesce = !options.replace && run?.what === what && now - run.at < 900;
      last.current = { what, at: now };

      store.designEdit(
        [
          {
            op: 'set_style',
            screen: screenId,
            element: elementId,
            styles,
            ...(options.replace ? { replace: true } : {}),
          },
        ],
        { history: !coalesce },
      );
    },
    [screenId, elementId],
  );
}

type Write = ReturnType<typeof useStyleWriter>;

/* ------------------------------------------------------------------ *
 * The controls
 * ------------------------------------------------------------------ */

/**
 * One labelled control, with the way back off it.
 *
 * A field that has been overridden is marked and carries a ×, because the
 * question "is this element like the others or not" is the one you cannot
 * answer by looking at the screen, and the answer decides whether a change to
 * the stylesheet will reach it.
 */
function Prop({
  label,
  set,
  onClear,
  wide,
  children,
}: {
  label: string;
  set: boolean;
  onClear: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`style-prop${set ? ' set' : ''}${wide ? ' wide' : ''}`}>
      <span className="style-prop-label">
        <span>{label}</span>
        {set ? (
          <button
            className="style-clear"
            title="Take the override off — back to what the stylesheet says"
            onClick={onClear}
          >
            ×
          </button>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * A text box that only commits when you are finished with it.
 *
 * Every commit is a document edit and a re-render of the artboard, so typing
 * `240` must not mean "2, then 24, then 240". Enter and leaving the box commit;
 * Escape puts it back. The arrow keys step a number, which is the one thing
 * every design tool has and nobody thinks to ask for.
 */
function DraftInput({
  value,
  placeholder,
  onCommit,
  list,
  className,
  numeric = true,
}: {
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  list?: string;
  className?: string;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const step = (by: number, from: string): void => {
    const match = /^(-?\d*\.?\d+)(.*)$/.exec(from.trim());
    if (!match) return;
    const next = `${Math.round((Number(match[1]) + by) * 100) / 100}${match[2]}`;
    setDraft(next);
    onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      onCommit(draft);
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      setDraft(value);
      event.currentTarget.blur();
      return;
    }
    if (!numeric || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const by = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1);
    step(by, draft || placeholder || '');
  };

  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      list={list}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

/** A length: pixels when you type a bare number, anything CSS when you don't. */
function LengthField({
  label,
  property,
  element,
  computed,
  write,
  list,
}: {
  label: string;
  property: string;
  element: ElementFacts;
  computed: Record<string, string>;
  write: Write;
  list?: string;
}) {
  const set = element.style[property] ?? '';
  return (
    <Prop label={label} set={Boolean(set)} onClear={() => write({ [property]: null })}>
      <DraftInput
        value={set}
        list={list}
        placeholder={computed[property] ?? ''}
        onCommit={(next) => write({ [property]: next.trim() ? cssLength(property, next) : null })}
      />
    </Prop>
  );
}

function SelectField({
  label,
  property,
  element,
  computed,
  write,
  options,
}: {
  label: string;
  property: string;
  element: ElementFacts;
  computed: Record<string, string>;
  write: Write;
  options: { value: string; label: string }[];
}) {
  const set = element.style[property] ?? '';
  const inherited = computed[property] ?? '';
  return (
    <Prop label={label} set={Boolean(set)} onClear={() => write({ [property]: null })}>
      <select value={set} onChange={(event) => write({ [property]: event.target.value || null })}>
        <option value="">{inherited ? `${inherited} (inherited)` : 'Default'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Prop>
  );
}

/**
 * A colour, offered as a token first and a swatch second.
 *
 * The swatch shows what the element actually is, resolved — otherwise picking
 * a colour would start from black every time, and half the point of a picker
 * is nudging the colour that is already there. Typing goes through a datalist
 * of the tokens, so the easy thing to write is the one that keeps following
 * the design system.
 */
function ColorField({
  label,
  property,
  element,
  computed,
  write,
}: {
  label: string;
  property: string;
  element: ElementFacts;
  computed: Record<string, string>;
  write: Write;
}) {
  const set = element.style[property] ?? '';
  const resolved = computed[property] ?? '';
  const swatch = toHex(!set || set.startsWith('var(') ? resolved : set);

  return (
    <Prop label={label} set={Boolean(set)} onClear={() => write({ [property]: null })} wide>
      <div className="style-color">
        <input
          type="color"
          className="style-swatch"
          value={swatch}
          title="Pick a colour"
          onChange={(event) => write({ [property]: event.target.value })}
        />
        <DraftInput
          value={set}
          numeric={false}
          list="dz-style-colors"
          placeholder={isTransparent(resolved) ? 'none' : resolved}
          onCommit={(next) => write({ [property]: next.trim() || null })}
        />
      </div>
    </Prop>
  );
}

/**
 * Four sides that are usually the same number.
 *
 * Linked by default, because "16 all round" is what padding nearly always is
 * and typing it four times is how a panel makes itself tiresome. The link is
 * dropped the moment the sides differ, so an element somebody set differently
 * is never quietly flattened.
 */
function SidesField({
  label,
  prefix,
  suffix,
  element,
  computed,
  write,
}: {
  label: string;
  prefix: string;
  suffix: string;
  element: ElementFacts;
  computed: Record<string, string>;
  write: Write;
}) {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const property = (side: string): string => `${prefix}-${side}${suffix}`;
  const values = sides.map((side) => element.style[property(side)] ?? '');
  const overridden = values.some(Boolean);
  // Linked only while the four sides really are one number — counting what
  // they resolve to, not only what was overridden. A card with 8px above and
  // 20px beside it must never be shown as "8 all round", or the first nudge
  // silently flattens a deliberate asymmetry.
  const resolved = sides.map((side) => values[sides.indexOf(side)] || computed[property(side)] || '');
  const uniform = resolved.every((value) => value === resolved[0]);
  const [linked, setLinked] = useState(true);
  const together = linked && uniform;

  const commit = (side: string, next: string): void => {
    const value = next.trim() ? cssLength(prefix, next) : null;
    if (!together) {
      write({ [property(side)]: value });
      return;
    }
    write(Object.fromEntries(sides.map((each) => [property(each), value])));
  };

  return (
    <Prop
      label={label}
      set={overridden}
      wide
      onClear={() => write(Object.fromEntries(sides.map((side) => [property(side), null])))}
    >
      <div className="style-sides">
        {(together ? (['top'] as const) : sides).map((side) => (
          <DraftInput
            key={side}
            className="style-side"
            value={element.style[property(side)] ?? ''}
            placeholder={computed[property(side)] ?? ''}
            onCommit={(next) => commit(side, next)}
          />
        ))}
        <button
          className={`style-link${linked ? ' on' : ''}`}
          title={linked ? 'All four sides together' : 'Each side on its own'}
          onClick={() => setLinked((was) => !was)}
        >
          {linked ? '⛓' : '⤫'}
        </button>
      </div>
      {together ? null : <span className="style-sides-key">top · right · bottom · left</span>}
    </Prop>
  );
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

export function DesignStyleForm({
  design,
  screen,
  element,
  measured,
}: {
  design: DesignDocument;
  screen: ScreenDesign;
  element: ElementFacts;
  measured: ElementMeasure | null;
}) {
  const write = useStyleWriter(screen.id, element.id);
  // Only the measurement of *this* element says anything about it. Anything
  // else is the last thing that was selected, and showing its font size here
  // would be worse than showing none.
  const computed =
    measured && measured.element === element.id && measured.screen === screen.id
      ? measured.computed
      : {};

  const isFlex = (element.style['display'] ?? computed['display'] ?? '').includes('flex');
  const types = typeClasses(design.system);
  const typeClass = element.classes.find((name) =>
    types.some((each) => each.className === name),
  );

  /** Swap the type token an element wears, leaving its other classes alone. */
  const setTypeClass = (className: string): void => {
    const kept = element.classes.filter((name) => !types.some((each) => each.className === name));
    const next = className ? [...kept, className] : kept;
    store.designEdit([
      {
        op: 'set_attribute',
        screen: screen.id,
        element: element.id,
        name: 'class',
        value: next.join(' ') || null,
      },
    ]);
  };

  const overrides = Object.keys(element.style).length;

  return (
    <>
      <datalist id="dz-style-colors">
        {colorSuggestions(design.system).map((token) => (
          <option key={token.value} value={token.value}>
            {token.label}
          </option>
        ))}
      </datalist>

      {/* ---- size ---- */}
      <section className="inspector-section">
        <h4>Size</h4>
        <div className="style-grid">
          <LengthField
            label="Width"
            property="width"
            element={element}
            computed={computed}
            write={write}
          />
          <LengthField
            label="Height"
            property="height"
            element={element}
            computed={computed}
            write={write}
          />
        </div>
        <details className="style-more">
          <summary>Limits</summary>
          <div className="style-grid">
            {(
              [
                ['Min W', 'min-width'],
                ['Max W', 'max-width'],
                ['Min H', 'min-height'],
                ['Max H', 'max-height'],
              ] as const
            ).map(([label, property]) => (
              <LengthField
                key={property}
                label={label}
                property={property}
                element={element}
                computed={computed}
                write={write}
              />
            ))}
          </div>
        </details>
        <p className="style-note">
          Drag the handles on the artboard to size it by eye. A bare number means pixels; `auto`,
          `50%` and `calc(…)` all work.
        </p>
      </section>

      {/* ---- layout ---- */}
      <section className="inspector-section">
        <h4>Layout</h4>
        <div className="style-grid">
          <SelectField
            label="Display"
            property="display"
            element={element}
            computed={computed}
            write={write}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'flex', label: 'Flex' },
              { value: 'inline-flex', label: 'Inline flex' },
              { value: 'grid', label: 'Grid' },
              { value: 'inline-block', label: 'Inline block' },
              { value: 'inline', label: 'Inline' },
              { value: 'none', label: 'None' },
            ]}
          />
          <LengthField
            label="Gap"
            property="gap"
            element={element}
            computed={computed}
            write={write}
          />
        </div>

        {isFlex ? (
          <div className="style-grid">
            <SelectField
              label="Direction"
              property="flex-direction"
              element={element}
              computed={computed}
              write={write}
              options={[
                { value: 'row', label: 'Row' },
                { value: 'column', label: 'Column' },
                { value: 'row-reverse', label: 'Row reversed' },
                { value: 'column-reverse', label: 'Column reversed' },
              ]}
            />
            <SelectField
              label="Wrap"
              property="flex-wrap"
              element={element}
              computed={computed}
              write={write}
              options={[
                { value: 'nowrap', label: 'No wrap' },
                { value: 'wrap', label: 'Wrap' },
              ]}
            />
            <SelectField
              label="Align"
              property="align-items"
              element={element}
              computed={computed}
              write={write}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Centre' },
                { value: 'flex-end', label: 'End' },
                { value: 'stretch', label: 'Stretch' },
                { value: 'baseline', label: 'Baseline' },
              ]}
            />
            <SelectField
              label="Justify"
              property="justify-content"
              element={element}
              computed={computed}
              write={write}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Centre' },
                { value: 'flex-end', label: 'End' },
                { value: 'space-between', label: 'Space between' },
                { value: 'space-around', label: 'Space around' },
              ]}
            />
          </div>
        ) : null}

        <SidesField
          label="Padding"
          prefix="padding"
          suffix=""
          element={element}
          computed={computed}
          write={write}
        />
        <SidesField
          label="Margin"
          prefix="margin"
          suffix=""
          element={element}
          computed={computed}
          write={write}
        />
      </section>

      {/* ---- type ---- */}
      <section className="inspector-section">
        <h4>Type</h4>

        {types.length ? (
          <Prop
            label="Type style"
            set={Boolean(typeClass)}
            wide
            onClear={() => setTypeClass('')}
          >
            <select value={typeClass ?? ''} onChange={(event) => setTypeClass(event.target.value)}>
              <option value="">None — the element's own</option>
              {types.map((each) => (
                <option key={each.className} value={each.className}>
                  {each.label}
                </option>
              ))}
            </select>
          </Prop>
        ) : null}

        <Prop
          label="Font"
          set={Boolean(element.style['font-family'])}
          wide
          onClear={() => write({ 'font-family': null })}
        >
          <div className="style-color">
            <select
              className="style-font-pick"
              value=""
              title="Pick a font stack"
              onChange={(event) =>
                event.target.value ? write({ 'font-family': event.target.value }) : undefined
              }
            >
              <option value="">▾</option>
              {FONT_STACKS.map((stack) => (
                <option key={stack.label} value={stack.value}>
                  {stack.label}
                </option>
              ))}
            </select>
            <DraftInput
              value={element.style['font-family'] ?? ''}
              numeric={false}
              placeholder={fontLabel(computed['font-family'] ?? '')}
              onCommit={(next) => write({ 'font-family': next.trim() || null })}
            />
          </div>
        </Prop>

        <div className="style-grid">
          <LengthField
            label="Size"
            property="font-size"
            element={element}
            computed={computed}
            write={write}
          />
          <SelectField
            label="Weight"
            property="font-weight"
            element={element}
            computed={computed}
            write={write}
            options={[
              { value: '300', label: 'Light 300' },
              { value: '400', label: 'Regular 400' },
              { value: '500', label: 'Medium 500' },
              { value: '600', label: 'Semibold 600' },
              { value: '700', label: 'Bold 700' },
              { value: '800', label: 'Heavy 800' },
            ]}
          />
          <LengthField
            label="Line height"
            property="line-height"
            element={element}
            computed={computed}
            write={write}
          />
          <LengthField
            label="Tracking"
            property="letter-spacing"
            element={element}
            computed={computed}
            write={write}
          />
        </div>

        <div className="style-grid">
          <SelectField
            label="Align"
            property="text-align"
            element={element}
            computed={computed}
            write={write}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
              { value: 'justify', label: 'Justify' },
            ]}
          />
          <SelectField
            label="Case"
            property="text-transform"
            element={element}
            computed={computed}
            write={write}
            options={[
              { value: 'none', label: 'As written' },
              { value: 'uppercase', label: 'UPPER' },
              { value: 'capitalize', label: 'Capitalised' },
              { value: 'lowercase', label: 'lower' },
            ]}
          />
        </div>

        <ColorField
          label="Text colour"
          property="color"
          element={element}
          computed={computed}
          write={write}
        />
      </section>

      {/* ---- fill and border ---- */}
      <section className="inspector-section">
        <h4>Fill &amp; border</h4>

        <ColorField
          label="Background"
          property="background-color"
          element={element}
          computed={computed}
          write={write}
        />

        <div className="style-grid">
          <LengthField
            label="Border"
            property="border-width"
            element={element}
            computed={{ ...computed, 'border-width': computed['border-top-width'] ?? '' }}
            write={write}
          />
          <SelectField
            label="Style"
            property="border-style"
            element={element}
            computed={{ ...computed, 'border-style': computed['border-top-style'] ?? '' }}
            write={write}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
              { value: 'none', label: 'None' },
            ]}
          />
        </div>

        <ColorField
          label="Border colour"
          property="border-color"
          element={element}
          computed={{ ...computed, 'border-color': computed['border-top-color'] ?? '' }}
          write={write}
        />

        <LengthField
          label="Corner radius"
          property="border-radius"
          element={element}
          computed={computed}
          write={write}
          list="dz-style-radii"
        />
        <datalist id="dz-style-radii">
          {radiusSuggestions(design.system).map((token) => (
            <option key={token.value} value={token.value}>
              {token.label}
            </option>
          ))}
        </datalist>

        <Prop
          label="Shadow"
          set={Boolean(element.style['box-shadow'])}
          wide
          onClear={() => write({ 'box-shadow': null })}
        >
          <DraftInput
            value={element.style['box-shadow'] ?? ''}
            numeric={false}
            list="dz-style-shadows"
            placeholder={computed['box-shadow'] === 'none' ? 'none' : (computed['box-shadow'] ?? '')}
            onCommit={(next) => write({ 'box-shadow': next.trim() || null })}
          />
        </Prop>
        <datalist id="dz-style-shadows">
          {shadowSuggestions(design.system).map((token) => (
            <option key={token.value} value={token.value}>
              {token.label}
            </option>
          ))}
          <option value="none">No shadow</option>
        </datalist>

        <Prop
          label={`Opacity ${Math.round(Number(element.style['opacity'] ?? computed['opacity'] ?? 1) * 100)}%`}
          set={Boolean(element.style['opacity'])}
          wide
          onClear={() => write({ opacity: null })}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(Number(element.style['opacity'] ?? computed['opacity'] ?? 1) * 100)}
            onChange={(event) =>
              write({ opacity: String(Math.round(Number(event.target.value)) / 100) })
            }
          />
        </Prop>
      </section>

      {/* ---- the escape hatch ---- */}
      <section className="inspector-section">
        <h4>Anything else</h4>
        <RawStyle element={element} write={write} />
        {overrides ? (
          <button
            className="btn subtle small"
            onClick={() => write({}, { replace: true })}
            title="Back to the stylesheet, in every respect"
          >
            Clear {overrides} override{overrides === 1 ? '' : 's'}
          </button>
        ) : (
          <p className="style-note">
            Nothing on this element is overridden — it looks the way the stylesheet and the tokens
            say it should.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * The overrides as CSS, for the properties no panel will ever have a box for.
 *
 * Every design tool needs the door marked "I know what I am doing": a
 * `transform`, a `grid-template-columns`, a `backdrop-filter`. What is typed
 * here replaces the element's overrides wholesale, which is also the quickest
 * way to copy a look from one element to another.
 */
function RawStyle({ element, write }: { element: ElementFacts; write: Write }) {
  const current = formatInlineStyle(element.style);
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  return (
    <label className="field">
      <span>THIS ELEMENT’S OWN CSS</span>
      <textarea
        rows={3}
        spellCheck={false}
        value={draft}
        placeholder="transform: rotate(-2deg); backdrop-filter: blur(4px)"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === current) return;
          const parsed: Record<string, string | null> = parseInlineStyle(draft);
          write(parsed, { replace: true });
        }}
      />
    </label>
  );
}
