import { selectionMetrics, type ShapeObject } from '../../core/scene';
import type { ParametricShapeSpec } from '../../core/shapes';
import { Field } from '../kit';
import { useDebouncedCommit } from './use-debounced-commit';

export function SelectedShapeGeometryFields(props: {
  readonly object: ShapeObject;
  readonly setSpec: (spec: ParametricShapeSpec) => void;
}): JSX.Element | null {
  const spec = props.object.spec;
  const scale = specScale(props.object.transform);
  const fields = ((): JSX.Element | null => {
    switch (spec.kind) {
      case 'rect':
        return <RectangleFields spec={spec} setSpec={props.setSpec} scale={scale} />;
      case 'ellipse':
        return <EllipseFields spec={spec} setSpec={props.setSpec} scale={scale} />;
      case 'polygon':
        return <PolygonFields spec={spec} setSpec={props.setSpec} scale={scale} />;
      case 'star':
        return <StarFields spec={spec} setSpec={props.setSpec} scale={scale} />;
      case 'polyline':
        return null;
    }
  })();
  if (fields === null) return null;
  return (
    <>
      {fields}
      <RotatedFootprintNote object={props.object} />
    </>
  );
}

// Width/Height above are the shape's OWN size (the LightBurn Shape Properties
// convention) while the toolbar reports the rotated footprint's axis-aligned
// bounds. For a rotated shape both are true and DIFFERENT — a 40×20 rectangle
// at 45° occupies 42.4×42.4 on the bed. Naming the second quantity, computed
// by the same selectionMetrics the toolbar uses, keeps the two surfaces from
// looking contradictory.
function RotatedFootprintNote(props: { readonly object: ShapeObject }): JSX.Element | null {
  const rotationDeg = props.object.transform.rotationDeg % 360;
  if (rotationDeg === 0) return null;
  const metrics = selectionMetrics([props.object]);
  if (metrics === null) return null;
  return (
    <p role="note" style={footprintNoteStyle}>
      Rotated footprint on the bed: {formatShapeValue(metrics.width)} ×{' '}
      {formatShapeValue(metrics.height)} mm. Width and height above are the shape&apos;s own,
      unrotated size — the toolbar shows this footprint.
    </p>
  );
}

const footprintNoteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 6px 0',
};

type SetSpec = (spec: ParametricShapeSpec) => void;

/**
 * How many bed millimetres one spec millimetre covers on each axis.
 *
 * A spec holds the shape's *authored* size; the toolbar's W/H resize scales
 * `transform` and never rewrites the spec, so the raw spec stops describing
 * what is on the bed as soon as either surface is used. These fields report
 * bed millimetres — the same quantity the toolbar names — so the two agree.
 * Mirroring lives in its own flags, hence the magnitude.
 */
type SpecScale = { readonly x: number; readonly y: number };

const UNSCALED = 1;
function specScale(transform: ShapeObject['transform']): SpecScale {
  const axis = (value: number): number =>
    Number.isFinite(value) && value !== 0 ? Math.abs(value) : UNSCALED;
  return { x: axis(transform.scaleX), y: axis(transform.scaleY) };
}

function RectangleFields(props: {
  readonly spec: Extract<ParametricShapeSpec, { readonly kind: 'rect' }>;
  readonly setSpec: SetSpec;
  readonly scale: SpecScale;
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Width"
        ariaLabel="Rectangle width"
        unit="mm"
        value={props.spec.widthMm}
        scale={props.scale.x}
        min={0.01}
        step={0.1}
        commit={(widthMm) => props.setSpec({ ...props.spec, widthMm })}
      />
      <ShapeNumberField
        label="Height"
        ariaLabel="Rectangle height"
        unit="mm"
        value={props.spec.heightMm}
        scale={props.scale.y}
        min={0.01}
        step={0.1}
        commit={(heightMm) => props.setSpec({ ...props.spec, heightMm })}
      />
      <ShapeNumberField
        label="Corner radius"
        ariaLabel="Rectangle corner radius"
        unit="mm"
        value={props.spec.cornerRadiusMm}
        // A radius has no single axis; under a non-uniform scale the smaller
        // one is what the corner can actually fit inside.
        scale={Math.min(props.scale.x, props.scale.y)}
        min={0}
        max={Math.min(props.spec.widthMm, props.spec.heightMm) / 2}
        step={0.1}
        commit={(cornerRadiusMm) => props.setSpec({ ...props.spec, cornerRadiusMm })}
      />
    </>
  );
}

function EllipseFields(props: {
  readonly spec: Extract<ParametricShapeSpec, { readonly kind: 'ellipse' }>;
  readonly setSpec: SetSpec;
  readonly scale: SpecScale;
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Width"
        ariaLabel="Ellipse width"
        unit="mm"
        value={props.spec.widthMm}
        scale={props.scale.x}
        min={0.01}
        step={0.1}
        commit={(widthMm) => props.setSpec({ ...props.spec, widthMm })}
      />
      <ShapeNumberField
        label="Height"
        ariaLabel="Ellipse height"
        unit="mm"
        value={props.spec.heightMm}
        scale={props.scale.y}
        min={0.01}
        step={0.1}
        commit={(heightMm) => props.setSpec({ ...props.spec, heightMm })}
      />
    </>
  );
}

function PolygonFields(props: {
  readonly spec: Extract<ParametricShapeSpec, { readonly kind: 'polygon' }>;
  readonly setSpec: SetSpec;
  readonly scale: SpecScale;
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Sides"
        ariaLabel="Polygon sides"
        value={props.spec.sides}
        min={3}
        max={64}
        step={1}
        integer
        commit={(sides) => props.setSpec({ ...props.spec, sides })}
      />
      <ShapeNumberField
        label="Radius"
        ariaLabel="Polygon radius"
        unit="mm"
        value={props.spec.radiusMm}
        scale={Math.min(props.scale.x, props.scale.y)}
        min={0.01}
        step={0.1}
        commit={(radiusMm) => props.setSpec({ ...props.spec, radiusMm })}
      />
    </>
  );
}

function StarFields(props: {
  readonly spec: Extract<ParametricShapeSpec, { readonly kind: 'star' }>;
  readonly setSpec: SetSpec;
  readonly scale: SpecScale;
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Points"
        ariaLabel="Star points"
        value={props.spec.points}
        min={3}
        max={64}
        step={1}
        integer
        commit={(points) => props.setSpec({ ...props.spec, points })}
      />
      <ShapeNumberField
        label="Outer radius"
        ariaLabel="Star outer radius"
        unit="mm"
        value={props.spec.outerRadiusMm}
        scale={Math.min(props.scale.x, props.scale.y)}
        min={0.01}
        step={0.1}
        commit={(outerRadiusMm) => props.setSpec({ ...props.spec, outerRadiusMm })}
      />
      <ShapeNumberField
        label="Inset"
        ariaLabel="Star inner radius"
        unit="%"
        value={props.spec.innerRadiusRatio * 100}
        min={5}
        max={95}
        step={1}
        commit={(percent) => props.setSpec({ ...props.spec, innerRadiusRatio: percent / 100 })}
      />
    </>
  );
}

/**
 * `value`, `min` and `max` are all in spec units; `scale` converts them to the
 * bed millimetres the operator sees and types. Clamping stays in spec units so
 * the shape's own limits (a corner radius cannot exceed half its shorter side)
 * hold no matter how the object is scaled.
 */
type ShapeNumberFieldProps = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly unit?: string;
  readonly value: number;
  /** Bed millimetres per spec millimetre. Unitless fields leave this at 1. */
  readonly scale?: number;
  readonly min: number;
  readonly max?: number;
  readonly step: number;
  readonly integer?: boolean;
  readonly commit: (value: number) => void;
};

function ShapeNumberField(props: ShapeNumberFieldProps): JSX.Element {
  // A scale change remounts the input so cleanup cancels any pending commit
  // parsed under the old display mapping. The new instance also starts with
  // the correctly scaled draft; ordinary typing never changes the key.
  return <ShapeNumberInput key={props.scale ?? UNSCALED} {...props} />;
}

function ShapeNumberInput(props: ShapeNumberFieldProps): JSX.Element {
  const scale = props.scale ?? UNSCALED;
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.commit,
    // The box shows spec × scale; a toolbar resize changes the scale while
    // the spec stays put, so the scale must re-trigger reconciliation or the
    // stale draft would be committed back on blur (undoing the resize).
    reconcileKey: scale,
    parse: (input) => clampFieldValue(Number(input) / scale, props),
    // Display-only rounding: a drag-resized shape stores a long float
    // (e.g. 35.107387681635146) that overflowed the box. Show a clean value
    // like LightBurn; the underlying spec keeps full precision until edited.
    format: (value) => formatShapeValue(value * scale, props.integer),
  });
  return (
    <Field label={props.label} {...(props.unit === undefined ? {} : { unit: props.unit })}>
      <input
        type="number"
        min={props.min * scale}
        {...(props.max === undefined ? {} : { max: props.max * scale })}
        step={props.step}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        aria-label={props.ariaLabel}
        title={`${props.ariaLabel} for the selected shape.`}
        style={inputStyle}
      />
    </Field>
  );
}

// At most 3 decimals (0.001 mm — finer than anyone types), trailing zeros
// stripped. toFixed always emits a decimal point, so the zero-strip can't eat
// integer digits (e.g. "100" → "100.000" → "100").
const MAX_DIMENSION_DECIMALS = 3;
function formatShapeValue(value: number, integer?: boolean): string {
  if (!Number.isFinite(value)) return '';
  if (integer === true) return String(Math.round(value));
  return value.toFixed(MAX_DIMENSION_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
}

function clampFieldValue(
  value: number,
  bounds: {
    readonly value: number;
    readonly min: number;
    readonly max?: number;
    readonly integer?: boolean;
  },
): number {
  if (!Number.isFinite(value)) return bounds.value;
  const bounded = Math.min(bounds.max ?? Number.POSITIVE_INFINITY, Math.max(bounds.min, value));
  return bounds.integer === true ? Math.round(bounded) : bounded;
}

export function isParametricShapeObject(object: ShapeObject): object is ShapeObject & {
  readonly spec: ParametricShapeSpec;
} {
  return object.spec.kind !== 'polyline';
}

// Paint (border, background, padding) comes from the .lf-pane-form scope in
// tokens.css so this field matches every other control on the rail.
const inputStyle: React.CSSProperties = { width: 84, minWidth: 0, boxSizing: 'border-box' };
