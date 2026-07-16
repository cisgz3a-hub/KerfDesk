// The Job Review stat-tile row: estimated time, job size, operations /
// cutters, and G-code size, computed from the exact prepared program
// (ADR-224). Dims with aria-busy while the gate re-prepares after an edit.

import type { JobReviewStatTile } from './job-review-model';
import {
  recomputingStyle,
  statDetailStyle,
  statLabelStyle,
  statRowStyle,
  statValueStyle,
} from './job-review.styles';

export function JobReviewStats(props: {
  readonly stats: ReadonlyArray<JobReviewStatTile>;
  readonly isPreparing: boolean;
}): JSX.Element {
  return (
    <div aria-busy={props.isPreparing} style={statRowStyle}>
      {props.stats.map((tile) => (
        <div key={tile.label} className="lf-card" style={tileStyle(props.isPreparing)}>
          <span style={statLabelStyle}>{tile.label}</span>
          <span style={statValueStyle}>{tile.value}</span>
          <span style={statDetailStyle}>{tile.detail}</span>
        </div>
      ))}
      {props.isPreparing ? (
        <span role="status" style={recomputingStyle}>
          Recomputing with your latest edits…
        </span>
      ) : null}
    </div>
  );
}

function tileStyle(isPreparing: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '8px 10px',
    opacity: isPreparing ? 0.55 : 1,
  };
}
