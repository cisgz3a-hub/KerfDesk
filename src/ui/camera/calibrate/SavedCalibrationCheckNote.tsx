// SavedCalibrationCheckNote — what a new photo of the engraved target says
// about the calibration already saved (ADR-441 Amendment 1): unchanged, off
// by a measured amount in a direction, or not comparable and why.

import { savedCalibrationVerdict, type SavedCalibrationCheck } from './saved-calibration-check';
import { noteStyle } from './wizard-styles';

export function SavedCalibrationCheckNote(props: {
  readonly check: SavedCalibrationCheck;
}): JSX.Element {
  const { check } = props;
  if (check.kind === 'not-comparable') {
    return (
      <section style={sectionStyle} aria-label="Saved calibration">
        <p style={noteStyle}>{check.message}</p>
      </section>
    );
  }
  const verdict = savedCalibrationVerdict(check);
  return (
    <section style={sectionStyle} aria-label="Saved calibration">
      <p style={{ margin: 0, fontWeight: 600, color: verdict.moved ? MOVED : UNCHANGED }}>
        {verdict.headline}
      </p>
      <p style={noteStyle}>{verdict.detail}</p>
    </section>
  );
}

const MOVED = 'var(--lf-warning-fg)';
const UNCHANGED = 'var(--lf-success-fg)';
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  borderLeft: '3px solid var(--lf-border)',
};
