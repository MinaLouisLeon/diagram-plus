import {
  useCallback,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  ELEMENT_CATALOG,
  elementLabel,
  type DesignElement,
  type DesignSystem,
} from '@diagram-plus/core/browser';
import {
  color,
  containerStyle,
  elementStyle,
  hairline,
  mutedInk,
  typography,
} from '../design-css';

/**
 * Drawing an element.
 *
 * Every type gets the chrome that makes it recognisable — a field looks like a
 * field, a button looks like a button — because the whole point of designing
 * here rather than in a drawing tool is that what you place is a real control
 * with real properties, and it should look like one while you place it.
 *
 * Nothing here is interactive as a control: an input cannot be typed into, a
 * button cannot be pressed. Clicking selects. This is a design surface, not a
 * prototype, and a half-working form would be worse than an honest picture of
 * one.
 */

export interface ElementViewProps {
  element: DesignElement;
  system: DesignSystem;
  /** Which way the containing element runs — decides what "fill" means. */
  parentDirection?: 'row' | 'column';
  /** What holds it — only a `frame` honours a child placed at x/y. */
  parentType?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Called when an element is dropped onto this one, or beside it. */
  onMove?: (elementId: string, parentId: string, index: number) => void;
  /** Read-only rendering: no selection outlines, no drag handles. */
  presenting?: boolean;
}

/** Types the canvas draws a label and a helper line around. */
const LABELLED = new Set([
  'input',
  'textarea',
  'select',
  'search',
  'upload',
  'slider',
  'radio',
]);

export function ElementView(props: ElementViewProps) {
  const { element, system, parentDirection = 'column', parentType, selectedId, onSelect, presenting } = props;
  const info = ELEMENT_CATALOG[element.type];
  const selected = !presenting && selectedId === element.id;

  const select = useCallback(
    (event: MouseEvent) => {
      if (presenting) return;
      // The innermost element under the pointer wins, which is what clicking
      // a button inside a card has to mean.
      event.stopPropagation();
      onSelect(element.id);
    },
    [element.id, onSelect, presenting],
  );

  const box = elementStyle(element, system, parentDirection, parentType);
  const control = <Control {...props} />;

  // A field carries its own label and helper line, which sit outside the box
  // the element's own styling describes.
  const body = LABELLED.has(element.type) && (element.label || element.helper)
    ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {element.label ? (
          <span style={{ ...typography(system, 'caption'), color: mutedInk(system) }}>
            {element.label}
            {element.required ? <span style={{ color: color(system, 'danger') }}> *</span> : null}
          </span>
        ) : null}
        {control}
        {element.helper ? (
          <span style={{ ...typography(system, 'caption'), color: mutedInk(system) }}>
            {element.helper}
          </span>
        ) : null}
      </div>
    )
    : control;

  // The wrapper carries the sizing so the label block stretches with it, and
  // the control keeps the padding and the border the element describes.
  const outer: CSSProperties = LABELLED.has(element.type) && (element.label || element.helper)
    ? {
        ...sizingOnly(box),
        position: box.position,
        left: box.left,
        top: box.top,
        opacity: box.opacity,
      }
    : box;

  return (
    <div
      className={`dz-el${selected ? ' selected' : ''}${element.locked ? ' locked' : ''}`}
      style={outer}
      onClick={select}
      title={presenting ? undefined : `${elementLabel(element.type, element.name, element.text)} — ${info.label}`}
      data-element={element.id}
      draggable={!presenting && !element.locked}
      onDragStart={(event) => startDrag(event, element.id)}
      onDragOver={(event) => allowDrop(event)}
      onDrop={(event) => handleDrop(event, props)}
    >
      {body}
      {selected ? <span className="dz-el-badge">{info.label}</span> : null}
    </div>
  );
}

/**
 * The properties that decide how wide a wrapped field is — but not how tall.
 *
 * A field's height belongs to its control: an input set to 40px means a 40px
 * input, not a 40px stack of label, input and helper line. The wrapper hugs
 * whatever those come to, and `fieldBox` gives the control back its height.
 */
function sizingOnly(style: CSSProperties): CSSProperties {
  const { width, flexGrow, flexShrink, flexBasis, minWidth } = style;
  return { width, flexGrow, flexShrink, flexBasis, minWidth, boxSizing: 'border-box' };
}

/* ------------------------------------------------------------------ *
 * Dragging elements around
 * ------------------------------------------------------------------ */

function startDrag(event: DragEvent, id: string): void {
  event.stopPropagation();
  event.dataTransfer.setData('application/x-design-element', id);
  event.dataTransfer.effectAllowed = 'move';
}

function allowDrop(event: DragEvent): void {
  if (!event.dataTransfer.types.includes('application/x-design-element')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.stopPropagation();
}

/**
 * Work out where a dropped element should land.
 *
 * Dropping onto a container puts it inside; dropping onto anything else puts
 * it beside — before or after, depending on which half of the box the pointer
 * is in. That is the behaviour every layers panel in every design tool has,
 * and doing anything else here would be surprising.
 */
function handleDrop(event: DragEvent, props: ElementViewProps): void {
  const moved = event.dataTransfer.getData('application/x-design-element');
  if (!moved || !props.onMove) return;
  event.preventDefault();
  event.stopPropagation();
  if (moved === props.element.id) return;

  const info = ELEMENT_CATALOG[props.element.type];
  if (info.container) {
    props.onMove(moved, props.element.id, -1);
    return;
  }

  const box = event.currentTarget.getBoundingClientRect();
  const vertical = (props.parentDirection ?? 'column') === 'column';
  const past = vertical
    ? event.clientY > box.top + box.height / 2
    : event.clientX > box.left + box.width / 2;
  // The parent is resolved by the canvas from the element id, so -1 here would
  // be ambiguous; the sibling's own id plus a side is what it needs.
  props.onMove(moved, `${props.element.id}:${past ? 'after' : 'before'}`, -1);
}

/* ------------------------------------------------------------------ *
 * The elements themselves
 * ------------------------------------------------------------------ */

function Children({ props, of }: { props: ElementViewProps; of: DesignElement }) {
  const direction = of.type === 'grid' ? 'column' : of.layout.direction;
  return (
    <>
      {of.children.map((child) => (
        <ElementView
          key={child.id}
          {...props}
          element={child}
          parentDirection={direction}
          parentType={of.type}
        />
      ))}
    </>
  );
}

/** Draw a repeating container's children once per record. */
function Repeated({ props, of }: { props: ElementViewProps; of: DesignElement }) {
  const count = of.repeat ? Math.max(1, of.repeat.count) : 1;
  if (!of.repeat || of.children.length === 0) return <Children props={props} of={of} />;

  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          style={{ display: 'contents' }}
          // Only the first copy is the real element; the rest are a preview of
          // what the repeat means, and must not be selectable or draggable.
          aria-hidden={index > 0}
        >
          {index === 0 ? (
            <Children props={props} of={of} />
          ) : (
            of.children.map((child) => (
              <div key={child.id} style={{ display: 'contents', pointerEvents: 'none' }}>
                <ElementView
                  {...props}
                  element={child}
                  parentDirection={of.layout.direction}
                  parentType={of.type}
                  selectedId={null}
                  presenting
                />
              </div>
            ))
          )}
        </div>
      ))}
    </>
  );
}

function Control(props: ElementViewProps) {
  const { element, system } = props;
  const ink = mutedInk(system);
  const line = hairline(system);
  const box = elementStyle(element, system, props.parentDirection ?? 'column', props.parentType);

  const contained = (children: ReactNode) => (
    <div style={{ ...containerStyle(element), width: '100%', height: '100%' }}>{children}</div>
  );

  switch (element.type) {
    /* ---- containers ---- */
    case 'frame':
    case 'stack':
    case 'card':
    case 'form':
    case 'header':
    case 'footer':
    case 'sidebar':
    case 'modal':
      return contained(<Children props={props} of={element} />);

    case 'grid':
    case 'list':
      return contained(<Repeated props={props} of={element} />);

    case 'nav':
      return contained(
        <>
          {element.options.map((option, index) => (
            <span key={index} style={{ ...typography(system, 'body.md'), opacity: index ? 0.7 : 1 }}>
              {option.label || option.value || 'Link'}
            </span>
          ))}
          <Children props={props} of={element} />
        </>,
      );

    case 'tabs':
      return (
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${line}` }}>
            {(element.options.length ? element.options : [{ label: 'Tab', selected: true }]).map(
              (option, index) => (
                <span
                  key={index}
                  style={{
                    ...typography(system, 'body.md'),
                    padding: '8px 0',
                    color: option.selected ? undefined : ink,
                    borderBottom: option.selected
                      ? `2px solid ${color(system, 'accent') || '#2563eb'}`
                      : '2px solid transparent',
                  }}
                >
                  {option.label || 'Tab'}
                </span>
              ),
            )}
          </div>
          <div style={{ ...containerStyle(element), paddingTop: 16 }}>
            <Children props={props} of={element} />
          </div>
        </div>
      );

    /* ---- content ---- */
    case 'heading':
    case 'text':
      return <span style={{ whiteSpace: 'pre-wrap' }}>{element.text || ' '}</span>;

    case 'link':
      return (
        <span style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
          {element.text || 'Link'}
        </span>
      );

    case 'badge':
      return <span>{element.text || 'Badge'}</span>;

    case 'icon':
      return (
        <span style={{ fontSize: Math.min(Number(box.height) || 24, 64), lineHeight: 1 }}>
          {element.icon || '★'}
        </span>
      );

    case 'avatar':
      return (
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: '100%',
            height: '100%',
            fontSize: 14,
            color: ink,
          }}
        >
          {element.src ? '' : '🙂'}
        </span>
      );

    case 'divider':
    case 'spacer':
      return null;

    case 'image':
    case 'video':
    case 'map':
    case 'chart':
      return <Placeholder element={element} system={system} />;

    /* ---- controls ---- */
    case 'button':
      return (
        <span
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
          }}
        >
          {element.icon ? <span>{element.icon}</span> : null}
          {element.text || 'Button'}
        </span>
      );

    case 'input':
    case 'search':
      return (
        <span style={{ ...fieldBox(props), gap: 8 }}>
          {element.icon ? <span style={{ color: ink }}>{element.icon}</span> : null}
          <span style={{ color: ink, flex: 1 }}>
            {element.variant === 'password' ? '••••••••' : element.placeholder || ' '}
          </span>
        </span>
      );

    case 'textarea':
      return (
        <span style={{ ...fieldBox(props), alignItems: 'flex-start' }}>
          <span style={{ color: ink }}>{element.placeholder || ' '}</span>
        </span>
      );

    case 'select':
      return (
        <span style={fieldBox(props)}>
          <span style={{ color: ink, flex: 1 }}>
            {element.options.find((o) => o.selected)?.label ||
              element.placeholder ||
              element.options[0]?.label ||
              'Choose'}
          </span>
          <span style={{ color: ink }}>▾</span>
        </span>
      );

    case 'upload':
      return (
        <span
          style={{
            ...fieldBox(props),
            flexDirection: 'column',
            justifyContent: 'center',
            color: ink,
            gap: 4,
          }}
        >
          <span style={{ fontSize: 18 }}>⇧</span>
          <span>{element.placeholder || 'Drop a file here'}</span>
        </span>
      );

    case 'checkbox':
      return (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tick line={line} />
          <span>{element.label || element.text || 'Option'}</span>
        </span>
      );

    case 'radio':
      return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {(element.options.length ? element.options : [{ label: 'Option', selected: true }]).map(
            (option, index) => (
              <span key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    border: `1px solid ${line}`,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {option.selected ? (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: color(system, 'accent') || '#2563eb',
                      }}
                    />
                  ) : null}
                </span>
                <span>{option.label || 'Option'}</span>
              </span>
            ),
          )}
        </span>
      );

    case 'toggle':
      return (
        <span
          style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
        >
          <span>{element.label || element.text || 'Setting'}</span>
          <span
            style={{
              width: 40,
              height: 22,
              borderRadius: 999,
              background: color(system, 'accent') || '#2563eb',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                right: 3,
                width: 16,
                height: 16,
                borderRadius: 999,
                background: '#fff',
              }}
            />
          </span>
        </span>
      );

    case 'slider':
      return (
        <span style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
          <span style={{ height: 4, borderRadius: 999, background: line, flex: 1, position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '40%',
                top: -6,
                width: 16,
                height: 16,
                borderRadius: 999,
                background: color(system, 'accent') || '#2563eb',
              }}
            />
          </span>
        </span>
      );

    /* ---- data ---- */
    case 'table':
      return <Table element={element} system={system} />;

    case 'component':
      return (
        <span
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
            width: '100%',
            color: color(system, 'accent') || '#2563eb',
            ...typography(system, 'caption'),
          }}
        >
          ❖ {element.text || element.name || 'Component'}
        </span>
      );

    default: {
      // Every type in the catalog is handled above, so this is only reachable
      // if one is added without a case here.
      const unhandled: never = element.type;
      return <span>{String(unhandled)}</span>;
    }
  }
}

/** The inner box of a field: fills whatever the element's own styling gave it. */
function fieldBox(props: ElementViewProps): CSSProperties {
  const box = elementStyle(props.element, props.system, props.parentDirection ?? 'column', props.parentType);
  const labelled = props.element.label || props.element.helper;
  return {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minHeight: typeof box.height === 'number' ? box.height : 40,
    boxSizing: 'border-box',
    // When the label wrapper took the sizing, the inner box has to take back
    // the padding, the fill and the border the element actually described.
    ...(labelled
      ? {
          padding: box.padding,
          background: box.background,
          border: box.border,
          borderRadius: box.borderRadius,
        }
      : {}),
  };
}

function Tick({ line }: { line: string }) {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: `1px solid ${line}`,
        flexShrink: 0,
      }}
    />
  );
}

function Placeholder({
  element,
  system,
}: {
  element: DesignElement;
  system: DesignSystem;
}) {
  const info = ELEMENT_CATALOG[element.type];
  return (
    <span
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        color: mutedInk(system),
        ...typography(system, 'caption'),
      }}
    >
      <span style={{ fontSize: 20 }}>{info.icon}</span>
      <span style={{ textAlign: 'center', padding: '0 8px' }}>
        {element.src || element.text || info.label}
      </span>
    </span>
  );
}

function Table({
  element,
  system,
}: {
  element: DesignElement;
  system: DesignSystem;
}) {
  const columns = element.columns.length ? element.columns : ['Column'];
  const rows = element.repeat ? Math.max(1, element.repeat.count) : 3;
  const line = hairline(system);

  return (
    <span style={{ display: 'block', width: '100%' }}>
      <span style={{ display: 'flex', borderBottom: `1px solid ${line}`, paddingBottom: 8, gap: 16 }}>
        {columns.map((heading, index) => (
          <span
            key={index}
            style={{ flex: 1, ...typography(system, 'caption'), color: mutedInk(system) }}
          >
            {heading}
          </span>
        ))}
      </span>
      {Array.from({ length: rows }, (_, row) => (
        <span
          key={row}
          style={{
            display: 'flex',
            gap: 16,
            padding: '10px 0',
            borderBottom: `1px solid ${line}`,
            ...typography(system, 'body.sm'),
          }}
        >
          {columns.map((_, index) => (
            <span key={index} style={{ flex: 1, color: mutedInk(system) }}>
              ————
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
