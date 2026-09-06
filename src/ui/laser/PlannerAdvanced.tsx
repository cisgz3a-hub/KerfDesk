// PlannerAdvanced — hidden-by-default editor for local estimates using the
// recorded GRBL acceleration and junction deviation. Extracted
// from DeviceSettings.tsx so the parent stays under the 400-line
// hard cap (F-1 audit finding).
//
// Match the controller references before calibrating systematic ETA error.
// Acceleration also informs separately reviewed CNC recovery runways.
// <details> gives us native expand / collapse with no React state.

import { NumberField as ClearableNumberField } from '../common/NumberField';
import { MAX_ESTIMATE_TIME_SCALE, MIN_ESTIMATE_TIME_SCALE } from '../../core/devices';
import { inlineCodeStyle, numInputStyle, Row, unitStyle } from './device-settings-shared';

const MAX_ACCEL = 100000;
const MAX_JD_MM = 100;

type PlannerFieldsProps = {
  readonly accel: number;
  readonly jd: number;
  readonly cutTimeScale: number;
  readonly travelTimeScale: number;
  readonly onAccelChange: (next: number) => void;
  readonly onJdChange: (next: number) => void;
  readonly onCutTimeScaleChange: (next: number) => void;
  readonly onTravelTimeScaleChange: (next: number) => void;
};

export function PlannerAdvanced(props: PlannerFieldsProps): JSX.Element {
  return (
    <details style={advancedDetailsStyle}>
      <summary
        style={advancedSummaryStyle}
        title="Open or close advanced acceleration and junction-deviation estimator settings."
      >
        Advanced: estimator tuning
      </summary>
      <PlannerFields {...props} />
    </details>
  );
}

// The bare estimator fields, without a collapsible wrapper. Machine Setup's
// Options step renders these flat so no field hides two collapse levels deep
// (ADR-240); PlannerAdvanced keeps the legacy <details> shell.
export function PlannerFields(props: PlannerFieldsProps): JSX.Element {
  return (
    <>
      <div style={advancedBodyStyle}>
        <Row label="$120 accel">
          <ClearableNumberField
            min={1}
            max={MAX_ACCEL}
            step={50}
            value={props.accel}
            onCommit={props.onAccelChange}
            style={numInputStyle}
            ariaLabel="Acceleration (mm/s²)"
            title="Acceleration reference for time estimates and reviewed CNC recovery runways. Use the lower of the controller's $120/$121 values; editing this field does not write firmware settings or change controller acceleration."
          />
          <span style={unitStyle}>mm/s²</span>
        </Row>
        <Row label="$11 junction">
          <ClearableNumberField
            min={0.001}
            max={MAX_JD_MM}
            step={0.001}
            value={props.jd}
            onCommit={props.onJdChange}
            style={numInputStyle}
            ariaLabel="Junction deviation (mm)"
            title="Junction deviation used by KerfDesk's time estimates. Match the controller's $11 value; this field does not write firmware settings or change machine cornering."
          />
          <span style={unitStyle}>mm</span>
        </Row>
        <Row label="Cut time scale">
          <ClearableNumberField
            min={MIN_ESTIMATE_TIME_SCALE}
            max={MAX_ESTIMATE_TIME_SCALE}
            step={0.01}
            value={props.cutTimeScale}
            onCommit={props.onCutTimeScaleChange}
            style={numInputStyle}
            ariaLabel="Estimated cut time scale"
            title="Multiply estimated cutting, engraving, and plunge time. Use measured time divided by estimated time. This never changes machine feeds."
          />
          <span style={unitStyle}>x</span>
        </Row>
        <Row label="Travel time scale">
          <ClearableNumberField
            min={MIN_ESTIMATE_TIME_SCALE}
            max={MAX_ESTIMATE_TIME_SCALE}
            step={0.01}
            value={props.travelTimeScale}
            onCommit={props.onTravelTimeScaleChange}
            style={numInputStyle}
            ariaLabel="Estimated travel time scale"
            title="Multiply estimated rapid and laser-off travel time. Use measured time divided by estimated time. This never changes machine feeds."
          />
          <span style={unitStyle}>x</span>
        </Row>
        <p style={advancedHintStyle}>
          Match acceleration and junction deviation to the machine&apos;s{' '}
          <code style={inlineCodeStyle}>$$</code> output first. Then calibrate each time scale from
          a measured job. These are local profile references; editing them does not write firmware
          settings. Time scales apply to both the pre-run estimate and live countdown, while
          programmed dwell times remain unchanged. A value of 1.00 leaves motion time unchanged.
        </p>
      </div>
    </>
  );
}

const advancedDetailsStyle: React.CSSProperties = {
  marginTop: 4,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 4,
};
const advancedSummaryStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  cursor: 'pointer',
  userSelect: 'none',
};
const advancedBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 6,
};
const advancedHintStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-faint)',
  margin: '4px 0 0 0',
  fontStyle: 'italic',
};
