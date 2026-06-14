// PlannerAdvanced — hidden-by-default editor for the planner's GRBL
// settings ($120 acceleration + $11 junction deviation). Extracted
// from DeviceSettings.tsx so the parent stays under the 400-line
// hard cap (F-1 audit finding).
//
// Most users never touch these. They only matter when the job-time
// estimate is systematically off and the user wants to dial it in
// to their specific machine. <details> gives us native expand /
// collapse with no React state.

import { inlineCodeStyle, numInputStyle, Row, unitStyle } from './device-settings-shared';

export function PlannerAdvanced(props: {
  readonly accel: number;
  readonly jd: number;
  readonly onAccelChange: (next: number) => void;
  readonly onJdChange: (next: number) => void;
}): JSX.Element {
  return (
    <details style={advancedDetailsStyle}>
      <summary
        style={advancedSummaryStyle}
        title="Open or close advanced acceleration and junction-deviation estimator settings."
      >
        Advanced: estimator tuning
      </summary>
      <div style={advancedBodyStyle}>
        <Row label="$120 accel">
          <input
            type="number"
            min={1}
            step={50}
            value={props.accel}
            onChange={(e) => props.onAccelChange(Math.max(1, Number(e.target.value) || 0))}
            style={numInputStyle}
            aria-label="Acceleration (mm/s²)"
            title="GRBL $120/$121. Higher = faster cornering and shorter estimates. Typical 100-2500 mm/s²."
          />
          <span style={unitStyle}>mm/s²</span>
        </Row>
        <Row label="$11 junction">
          <input
            type="number"
            min={0.001}
            step={0.001}
            value={props.jd}
            onChange={(e) => props.onJdChange(Math.max(0, Number(e.target.value) || 0))}
            style={numInputStyle}
            aria-label="Junction deviation (mm)"
            title="GRBL $11. Higher = faster corners but more shake. Grbl default is 0.010 mm."
          />
          <span style={unitStyle}>mm</span>
        </Row>
        <p style={advancedHintStyle}>
          Tune these to match your machine&apos;s <code style={inlineCodeStyle}>$$</code> output
          when burn times consistently differ from the estimate. Defaults match the GRBL shipping
          standard.
        </p>
      </div>
    </details>
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
