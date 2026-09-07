import type { CSSProperties } from 'react';
import type {
  DesignElement,
  DesignSystem,
  Sizing,
} from '@diagram-plus/core/browser';

/**
 * Turning a design element into CSS.
 *
 * The document stores layout intent — "fill", "hug", `gap: 16`, `heading.lg`,
 * `accent` — not a stylesheet. This is the one place that decides what those
 * mean on screen, so the canvas draws exactly what the outline in the
 * implementation spec describes, and a token changed in the panel restyles
 * every artboard at once.
 *
 * It is deliberately not exported to the spec: what the implementer receives
 * is the intent, in their own stack's idiom. This is only how the editor draws
 * it.
 */

/* ------------------------------------------------------------------ *
 * Tokens
 * ------------------------------------------------------------------ */

/**
 * Resolve a token name to its value, falling through to the raw string.
 *
 * Anything that is not a known token is passed along untouched, so `#ff0000`,
 * `12px` and `rgba(...)` all keep working. That matters because a design in
 * progress is usually half token and half something somebody typed.
 */
export function color(system: DesignSystem, value: string): string {
  if (!value) return '';
  return system.colors.find((token) => token.name === value)?.value ?? value;
}

/** The readable colour for text on top of a background token. */
export function colorOn(system: DesignSystem, value: string): string {
  const token = system.colors.find((c) => c.name === value);
  return token?.on ? color(system, token.on) : '';
}

export function radius(system: DesignSystem, value: string): string {
  if (!value) return '';
  const token = system.radii.find((r) => r.name === value);
  if (token) return token.value;
  return /^\d+$/.test(value) ? `${value}px` : value;
}

export function shadow(system: DesignSystem, value: string): string {
  if (!value) return '';
  return system.shadows.find((s) => s.name === value)?.value ?? value;
}

/** A typography token as CSS. Unknown names fall back to inheriting. */
export function typography(system: DesignSystem, value: string): CSSProperties {
  const token = system.typography.find((t) => t.name === value);
  if (!token) return {};
  return {
    fontFamily: token.family || undefined,
    fontSize: token.size,
    fontWeight: token.weight,
    lineHeight: token.lineHeight,
    letterSpacing: token.letterSpacing ? `${token.letterSpacing}px` : undefined,
    textTransform: token.transform === 'none' ? undefined : token.transform,
  };
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * How a size behaves depends on which way its parent runs: "fill" across the
 * parent's direction is a width, along it is a share of the space. Getting
 * this right is what makes a designed row actually look like the row.
 */
function sizeAlong(
  value: Sizing,
  axis: 'width' | 'height',
  parentDirection: 'row' | 'column',
): CSSProperties {
  const isMainAxis = (axis === 'width') === (parentDirection === 'row');

  if (typeof value === 'number') {
    return isMainAxis
      ? { [axis]: value, flexShrink: 0, flexGrow: 0 }
      : { [axis]: value, flexShrink: 0 };
  }
  if (value === 'fill') {
    return isMainAxis ? { flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 } : { [axis]: '100%' };
  }
  // hug
  return isMainAxis ? { flexGrow: 0, flexShrink: 0 } : {};
}

/** The whole of an element's own box: its size, its padding, its look. */
export function elementStyle(
  element: DesignElement,
  system: DesignSystem,
  parentDirection: 'row' | 'column' = 'column',
): CSSProperties {
  const { layout, style } = element;
  const pad = layout.padding;

  const background = color(system, style.background);
  // A token that declares a readable colour for text on top of it supplies the
  // text colour, so a button set to `danger` is legible without being told.
  const text = color(system, style.color) || colorOn(system, style.background);

  const css: CSSProperties = {
    boxSizing: 'border-box',
    padding:
      pad.top || pad.right || pad.bottom || pad.left
        ? `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`
        : undefined,
    background: background || undefined,
    color: text || undefined,
    border:
      style.border && style.borderWidth
        ? `${style.borderWidth}px solid ${color(system, style.border)}`
        : undefined,
    borderRadius: radius(system, style.radius) || undefined,
    boxShadow: shadow(system, style.shadow) || undefined,
    opacity: style.opacity === 1 ? undefined : style.opacity,
    textAlign: style.align === 'left' ? undefined : style.align,
    ...typography(system, style.text),
    ...sizeAlong(layout.width, 'width', parentDirection),
    ...sizeAlong(layout.height, 'height', parentDirection),
  };

  if (layout.grow) css.flexGrow = layout.grow;
  if (element.hidden) css.opacity = 0.35;

  if (layout.absolute) {
    css.position = 'absolute';
    css.left = layout.x;
    css.top = layout.y;
    // Free placement is not part of a flow, so the flex sizing above would
    // only confuse the box it is no longer in.
    delete css.flexGrow;
    delete css.flexBasis;
  }

  return css;
}

/** How an element arranges the children it holds. */
export function containerStyle(element: DesignElement): CSSProperties {
  const { layout } = element;

  if (element.type === 'grid' && layout.columns > 0) {
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
      gap: layout.gap,
      alignItems: ALIGN[layout.align],
    };
  }

  return {
    display: 'flex',
    flexDirection: layout.direction,
    gap: layout.gap,
    alignItems: ALIGN[layout.align],
    justifyContent: JUSTIFY[layout.justify],
    flexWrap: layout.wrap ? 'wrap' : undefined,
    // A frame is the one container whose children may sit anywhere, so it has
    // to establish the coordinate system they are placed against.
    position: element.type === 'frame' ? 'relative' : undefined,
  };
}

/** What a screen's background resolves to. */
export function screenBackground(system: DesignSystem, value: string): string {
  return color(system, value) || '#ffffff';
}

/** The plain text colour for a screen, used for chrome the tokens do not cover. */
export function defaultInk(system: DesignSystem): string {
  return color(system, 'text') || '#0f172a';
}

export function mutedInk(system: DesignSystem): string {
  return color(system, 'subtle') || color(system, 'muted') || '#64748b';
}

export function hairline(system: DesignSystem): string {
  return color(system, 'border') || '#cbd5e1';
}
