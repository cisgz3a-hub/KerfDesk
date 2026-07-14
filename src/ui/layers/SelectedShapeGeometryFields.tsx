import type { ShapeObject } from '../../core/scene';
import type { ParametricShapeSpec } from '../../core/shapes';
import { Field } from '../kit';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

export function SelectedShapeGeometryFields(props: {
  readonly object: ShapeObject;
}): JSX.Element | null {
  const setSpec = useStore((state) => state.setSelectedShapeSpec);
  const spec = props.object.spec;
  switch (spec.kind) {
    case 'rect':
      return <RectangleFields spec={spec} setSpec={setSpec} />;
    case 'ellipse':
      return <EllipseFields spec={spec} setSpec={setSpec} />;
    case 'polygon':
      return <PolygonFields spec={spec} setSpec={setSpec} />;
    case 'star':
      return <StarFields spec={spec} setSpec={setSpec} />;
    case 'polyline':
      return null;
  }
}

type SetSpec = (spec: ParametricShapeSpec) => void;

function RectangleFields(props: {
  readonly spec: Extract<ParametricShapeSpec, { readonly kind: 'rect' }>;
  readonly setSpec: SetSpec;
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Width"
        ariaLabel="Rectangle width"
        unit="mm"
        value={props.spec.widthMm}
        min={0.01}
        step={0.1}
        commit={(widthMm) => props.setSpec({ ...props.spec, widthMm })}
      />
      <ShapeNumberField
        label="Height"
        ariaLabel="Rectangle height"
        unit="mm"
        value={props.spec.heightMm}
        min={0.01}
        step={0.1}
        commit={(heightMm) => props.setSpec({ ...props.spec, heightMm })}
      />
      <ShapeNumberField
        label="Corner radius"
        ariaLabel="Rectangle corner radius"
        unit="mm"
        value={props.spec.cornerRadiusMm}
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
}): JSX.Element {
  return (
    <>
      <ShapeNumberField
        label="Width"
        ariaLabel="Ellipse width"
        unit="mm"
        value={props.spec.widthMm}
        min={0.01}
        step={0.1}
        commit={(widthMm) => props.setSpec({ ...props.spec, widthMm })}
      />
      <ShapeNumberField
        label="Height"
        ariaLabel="Ellipse height"
        unit="mm"
        value={props.spec.heightMm}
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

function ShapeNumberField(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly unit?: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step: number;
  readonly integer?: boolean;
  readonly commit: (value: number) => void;
}): JSX.Element {
  const debounced = useDebouncedCommit<number>({
    value: props.value,
    commit: props.commit,
    parse: (input) => clampFieldValue(Number(input), props),
    // Display-only rounding: a drag-resized shape stores a long float
    // (e.g. 35.107387681635146) that overflowed the box. Show a clean value
    // like LightBurn; the underlying spec keeps full precision until edited.
    format: (value) => formatShapeValue(value, props.integer),
  });
  return (
    <Field
      label={props.label}
      labelWidth="md"
      {...(props.unit === undefined ? {} : { unit: props.unit })}
    >
      <input
        type="number"
        min={props.min}
        {...(props.max === undefined ? {} : { max: props.max })}
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
