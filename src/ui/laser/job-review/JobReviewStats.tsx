// The Job Review stat-tile band: estimated time (hero tile), job size,
// operations / cutters, G-code size, and the read-only origin, computed
// from the exact prepared program (ADR-224). Dims with aria-busy while the
// gate re-prepares after an edit.

import type { JobReviewStatTile } from './job-review-model';
import {
  heroTileStyle,
  heroValueColor,
  recomputingStyle,
  statDetailStyle,
  statLabelStyle,
  statRowStyle,
  statTextValueStyle,
  statTileStyle,
  statValueStyle,
} from './job-review.styles';

export function JobReviewStats(props: {
  readonly stats: ReadonlyArray<JobReviewStatTile>;
  readonly isPreparing: boolean;
}): JSX.Element {
  return (
    <div aria-busy={props.isPreparing} style={statRowStyle}>
      {props.stats.map((tile, index) => (
        <div key={tile.label} style={tileStyle(index === 0, props.isPreparing)}>
          <span style={statLabelStyle}>{tile.label}</span>
          <span style={valueStyle(tile, index === 0)}>{tile.value}</span>
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

// The model puts estimated time first; it renders as the accent hero tile.
function tileStyle(isHero: boolean, isPreparing: boolean): React.CSSProperties {
  return { ...(isHero ? heroTileStyle : statTileStyle), opacity: isPreparing ? 0.55 : 1 };
}

function valueStyle(tile: JobReviewStatTile, isHero: boolean): React.CSSProperties {
  const base = tile.emphasis === 'text' ? statTextValueStyle : statValueStyle;
  return isHero ? { ...base, color: heroValueColor } : base;
}
