// CalibrationResultStep — step 3 of the camera calibration wizard (ADR-441):
// how far each ring lands from where the laser engraved it, in millimetres,
// over the photo flattened onto the bed. A rough fit is described, never
// refused (ADR-228): Save is always available and the operator decides.

import { cameraModelHeightMm } from '../../../core/camera/model/camera-model-record';
import type { MarkError } from '../../../core/camera/target/bed-calibration';
import { useStore } from '../../state';
import { calibrationGrade, type CalibrationGrade } from './calibration-result';
import { useCameraCalibrationStore, type CalibrationResult } from './camera-calibration-store';
import { RgbaCanvas } from './RgbaCanvas';
import { columnStyle, noteStyle, rowStyle } from './wizard-styles';

// Above this the photo alone leaves the camera height loose enough to shift
// thick material by a visible amount (ADR-440).
const HEIGHT_ADVICE_SIGMA_MM = 10;
const GOOD_RING_MM = 0.25;
const FAIR_RING_MM = 0.6;

export function CalibrationResultStep(props: {
  readonly result: CalibrationResult;
  readonly save: (result: CalibrationResult) => void;
}): JSX.Element {
  const { result } = props;
  const { record } = result;
  const grade = calibrationGrade(record);
  const setStep = useCameraCalibrationStore((s) => s.setStep);

  return (
    <div style={columnStyle}>
      <p style={{ margin: 0, fontWeight: 600, color: TONE_COLORS[grade.tone] }}>{grade.headline}</p>
      <AccuracyFigures result={result} />
      {grade.advice === null ? null : <p style={noteStyle}>{grade.advice}</p>}
      {heightAdvice(result)}
      <BedAccuracyMap result={result} />
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={() => props.save(result)}
          title="Save this calibration to the machine profile and show the corrected camera on the canvas."
        >
          Save calibration
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'photo', status: { kind: 'idle' } })}
          title="Discard this result and take the photo again."
        >
          Take photo again
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setStep({ kind: 'setup', note: null })}
          title="Discard this result and change the target settings or engrave a new target."
        >
          Change settings
        </button>
      </div>
    </div>
  );
}

function AccuracyFigures(props: { readonly result: CalibrationResult }): JSX.Element {
  const { record, cameraHeightSigmaMm } = props.result;
  const { accuracy } = record;
  const height = cameraModelHeightMm(record);
  return (
    <dl style={figuresStyle}>
      <Figure label="Average error" value={`${accuracy.rmsErrorMm.toFixed(2)} mm`} />
      <Figure label="Worst ring" value={`${accuracy.maxErrorMm.toFixed(2)} mm`} />
      <Figure label="Rings found" value={`${accuracy.foundMarks} of ${accuracy.expectedMarks}`} />
      <Figure
        label="Camera height"
        value={`${Math.round(height)} mm ± ${Math.max(1, Math.round(cameraHeightSigmaMm))}`}
      />
    </dl>
  );
}

function Figure(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={figureStyle}>
      <dt style={figureLabelStyle}>{props.label}</dt>
      <dd style={figureValueStyle}>{props.value}</dd>
    </div>
  );
}

function heightAdvice(result: CalibrationResult): JSX.Element | null {
  if (result.usedMeasuredHeight || result.cameraHeightSigmaMm <= HEIGHT_ADVICE_SIGMA_MM)
    return null;
  return (
    <p style={noteStyle}>
      The camera looks almost straight down, so one photo cannot tell its height to better than ±
      {Math.round(result.cameraHeightSigmaMm)} mm. Placement on the target sheet is still exact, but
      thicker material may shift. Measure the lens height above the bed, enter it under Change
      settings, and take the photo again.
    </p>
  );
}

// The flattened photo with every ring's error drawn where it was engraved:
// the operator sees at a glance which part of the bed the camera trusts.
function BedAccuracyMap(props: { readonly result: CalibrationResult }): JSX.Element | null {
  const { bedImage, markErrors } = props.result;
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  if (bedImage === null) return null;
  return (
    <figure style={mapStyle}>
      <div style={mapFrameStyle}>
        <RgbaCanvas image={bedImage} alt="Camera photo flattened onto the bed" />
        <svg
          viewBox={`0 0 ${bedWidth} ${bedHeight}`}
          preserveAspectRatio="none"
          style={mapOverlayStyle}
          aria-hidden="true"
        >
          {markErrors.map((mark) => (
            <RingMark key={`${mark.x},${mark.y}`} mark={mark} bedWidth={bedWidth} />
          ))}
        </svg>
      </div>
      <figcaption style={noteStyle}>
        Each dot is a ring: green within {GOOD_RING_MM} mm, amber within {FAIR_RING_MM} mm, red
        beyond; a hollow circle was left out of the fit. Straight rows of rings mean the lens is
        corrected.
      </figcaption>
    </figure>
  );
}

function RingMark(props: { readonly mark: MarkError; readonly bedWidth: number }): JSX.Element {
  const { mark } = props;
  const radius = props.bedWidth / 120;
  const error = Math.hypot(mark.dxMm, mark.dyMm);
  if (mark.rejected) {
    return (
      <circle
        cx={mark.x}
        cy={mark.y}
        r={radius * 1.4}
        fill="none"
        stroke="var(--lf-danger-fg)"
        strokeWidth={radius / 2}
      />
    );
  }
  const fill =
    error <= GOOD_RING_MM
      ? 'var(--lf-success-fg)'
      : error <= FAIR_RING_MM
        ? 'var(--lf-warning-fg)'
        : 'var(--lf-danger-fg)';
  return <circle cx={mark.x} cy={mark.y} r={radius} fill={fill} />;
}

const TONE_COLORS: Readonly<Record<CalibrationGrade['tone'], string>> = {
  good: 'var(--lf-success-fg)',
  fair: 'var(--lf-warning-fg)',
  rough: 'var(--lf-danger-fg)',
};
const figuresStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
  gap: 8,
  margin: 0,
};
const figureStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--lf-bg-1)',
  borderRadius: 6,
};
const figureLabelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const figureValueStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};
const mapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: 0,
};
const mapFrameStyle: React.CSSProperties = { position: 'relative', lineHeight: 0 };
const mapOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
};
