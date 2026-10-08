// The Optimize Shapes dialog's settings (LightBurn gap LBG-T22): smoothing
// with its distance and corner angle, and fitting with its tolerance and the
// kinds of segment it may use. Numbers are kept as typed; the options read
// from them are clamped into range (and the decimal boxes carry no min or max,
// so a value between steps never stops the form from submitting).

import {
  CORNER_ANGLE_RANGE_DEG,
  DEFAULT_SHAPE_OPTIMIZE_OPTIONS,
  FIT_TOLERANCE_RANGE_MM,
  SMOOTHING_RANGE_MM,
  clampShapeOptimizeOptions,
  type ShapeOptimizeFitWith,
  type ShapeOptimizeOptions,
} from '../../core/geometry/shape-optimize/shape-optimize-options';
import { evaluateNumericEntry, type NumericEntryKind } from '../../core/numeric-expression';

export type OptimizeShapesForm = {
  readonly smooth: boolean;
  readonly smoothingText: string;
  readonly cornerText: string;
  readonly fit: boolean;
  readonly toleranceText: string;
  readonly fitWith: ShapeOptimizeFitWith;
};

type Patch = (patch: Partial<OptimizeShapesForm>) => void;

export const DEFAULT_OPTIMIZE_SHAPES_FORM: OptimizeShapesForm = {
  smooth: DEFAULT_SHAPE_OPTIMIZE_OPTIONS.smooth,
  smoothingText: String(DEFAULT_SHAPE_OPTIMIZE_OPTIONS.smoothingMm),
  cornerText: String(DEFAULT_SHAPE_OPTIMIZE_OPTIONS.cornerAngleDeg),
  fit: DEFAULT_SHAPE_OPTIMIZE_OPTIONS.fit,
  toleranceText: String(DEFAULT_SHAPE_OPTIMIZE_OPTIONS.fitToleranceMm),
  fitWith: DEFAULT_SHAPE_OPTIMIZE_OPTIONS.fitWith,
};

const FIT_WITH: ReadonlyArray<readonly [ShapeOptimizeFitWith, string]> = [
  ['lines-arcs-curves', 'Lines, arcs and curves'],
  ['lines-arcs', 'Lines and arcs only'],
];

// The slider runs on a log scale, so the fine end gets as much travel as the coarse.
const SLIDER_STEPS = 100;

export function optionsFromForm(form: OptimizeShapesForm): ShapeOptimizeOptions {
  return clampShapeOptimizeOptions({
    smooth: form.smooth,
    smoothingMm: numberOr(form.smoothingText, DEFAULT_SHAPE_OPTIMIZE_OPTIONS.smoothingMm),
    cornerAngleDeg: numberOr(
      form.cornerText,
      DEFAULT_SHAPE_OPTIMIZE_OPTIONS.cornerAngleDeg,
      'angle',
    ),
    fit: form.fit,
    fitToleranceMm: numberOr(form.toleranceText, DEFAULT_SHAPE_OPTIMIZE_OPTIONS.fitToleranceMm),
    fitWith: form.fitWith,
  });
}

export function SmoothFields(props: {
  readonly form: OptimizeShapesForm;
  readonly onChange: Patch;
}): JSX.Element {
  const { form, onChange } = props;
  const smoothing = optionsFromForm(form).smoothingMm;
  return (
    <fieldset style={groupStyle}>
      <Check
        label="Smooth"
        title="Smooth out jitter and pixel steps along the outlines. Corners stay sharp and in place, open ends stay put, and curves keep their size."
        checked={form.smooth}
        onChange={(smooth) => onChange({ smooth })}
      />
      <label style={fieldStyle}>
        <span>Smoothing (mm)</span>
        <span style={pairStyle}>
          <input
            type="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={sliderPosition(smoothing)}
            disabled={!form.smooth}
            title={`How strongly to smooth: wiggles shorter than about four times this distance along the outline are smoothed away. ${SMOOTHING_RANGE_MM.min} to ${SMOOTHING_RANGE_MM.max} mm.`}
            onChange={(event) =>
              onChange({ smoothingText: String(sliderValue(Number(event.currentTarget.value))) })
            }
          />
          <input
            type="text"
            className="lf-input"
            value={form.smoothingText}
            aria-invalid={
              evaluateNumericEntry(form.smoothingText, { kind: 'length' }).kind !== 'ok'
            }
            disabled={!form.smooth}
            title={`Arithmetic and units are accepted, for example 1/100in. Smoothing distance along the outline, ${SMOOTHING_RANGE_MM.min} to ${SMOOTHING_RANGE_MM.max} mm. Wiggles shorter than about four times this are smoothed away.`}
            onChange={(event) => onChange({ smoothingText: event.currentTarget.value })}
          />
        </span>
      </label>
      <label style={fieldStyle}>
        <span>Corner angle (°)</span>
        <input
          type="text"
          className="lf-input"
          value={form.cornerText}
          aria-invalid={evaluateNumericEntry(form.cornerText, { kind: 'angle' }).kind !== 'ok'}
          disabled={!form.smooth && !form.fit}
          title={`Arithmetic and degrees are accepted, for example 15+15deg. A point where the outline turns by more than this is a corner: it stays exactly where it is and stays sharp. ${CORNER_ANGLE_RANGE_DEG.min} to ${CORNER_ANGLE_RANGE_DEG.max} degrees; lower keeps more corners.`}
          onChange={(event) => onChange({ cornerText: event.currentTarget.value })}
        />
      </label>
    </fieldset>
  );
}

export function FitFields(props: {
  readonly form: OptimizeShapesForm;
  readonly onChange: Patch;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <fieldset style={groupStyle}>
      <Check
        label="Fit to lines, arcs and curves"
        title="Replace the outline's points with as few lines, arcs and curves as stay within the tolerance. Turn off to keep the (smoothed) outline as short straight lines."
        checked={form.fit}
        onChange={(fit) => onChange({ fit })}
      />
      <label style={fieldStyle}>
        <span>Tolerance (mm)</span>
        <input
          type="text"
          className="lf-input"
          value={form.toleranceText}
          aria-invalid={evaluateNumericEntry(form.toleranceText, { kind: 'length' }).kind !== 'ok'}
          disabled={!form.fit}
          title={`Arithmetic and units are accepted, for example 1/100in. Farthest the fitted outline may lie from the (smoothed) outline, ${FIT_TOLERANCE_RANGE_MM.min} to ${FIT_TOLERANCE_RANGE_MM.max} mm. Larger gives fewer segments.`}
          onChange={(event) => onChange({ toleranceText: event.currentTarget.value })}
        />
      </label>
      <label style={fieldStyle}>
        <span>Fit with</span>
        <select
          value={form.fitWith}
          disabled={!form.fit}
          title="Lines and arcs only suits controllers and CAM that take G2/G3 arcs but no curves; lines, arcs and curves gives the fewest segments."
          onChange={(event) =>
            onChange({ fitWith: event.currentTarget.value as ShapeOptimizeFitWith })
          }
        >
          {FIT_WITH.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function Check(props: {
  readonly label: string;
  readonly title: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkStyle}>
      <input
        type="checkbox"
        title={props.title}
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

function sliderPosition(smoothingMm: number): number {
  const { min, max } = SMOOTHING_RANGE_MM;
  return Math.round((SLIDER_STEPS * Math.log(smoothingMm / min)) / Math.log(max / min));
}

// Two significant figures: the slider picks a strength, the box an exact value.
function sliderValue(position: number): number {
  const { min, max } = SMOOTHING_RANGE_MM;
  const value = min * (max / min) ** (position / SLIDER_STEPS);
  return Number(value.toPrecision(2));
}

export function optimizeFormProblem(form: OptimizeShapesForm): string | null {
  const fields: Array<readonly [boolean, string, string, NumericEntryKind]> = [
    [form.smooth, 'Smoothing', form.smoothingText, 'length'],
    [form.smooth || form.fit, 'Corner angle', form.cornerText, 'angle'],
    [form.fit, 'Tolerance', form.toleranceText, 'length'],
  ];
  for (const [enabled, label, text, kind] of fields) {
    if (!enabled) continue;
    const value = evaluateNumericEntry(text, { kind });
    if (value.kind === 'invalid') return `${label}: ${value.message}.`;
  }
  return null;
}

function numberOr(text: string, fallback: number, kind: NumericEntryKind = 'length'): number {
  const value = evaluateNumericEntry(text, { kind });
  return value.kind === 'ok' ? value.value : fallback;
}

const groupStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 0,
  border: 'none',
};
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) 210px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const pairStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 72px',
  alignItems: 'center',
  gap: 6,
};
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
