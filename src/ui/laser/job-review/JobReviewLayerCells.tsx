// The per-row cell sets for the Job Review artwork-settings table: the
// editable core numbers for a laser or CNC operation, plus the shared name /
// mode-chip / detail-line cells (ADR-224 v2). Everything beyond the core
// numbers stays read-only in the review — Cancel and use the full layer
// editors for structural changes.

import type { CncLayerSettings, LayerOperationSettings } from '../../../core/scene';
import { withManualCncFeedPatch } from '../../state/cnc-feed-provenance';
import {
  airCellLabelStyle,
  detailCellStyle,
  materialChipDotStyle,
  materialChipStyle,
  modeChipStyle,
  operationNameCellStyle,
  operationNameInnerStyle,
  operationNameTextStyle,
  swatchStyle,
  tableCellStyle,
} from './job-review-table.styles';
import { ReviewNumberCell } from './ReviewNumberCell';

const PERCENT_MAX = 100;
const MIN_SPEED_MM_PER_MIN = 1;
const MIN_PASSES = 1;
const MIN_CNC_DEPTH_MM = 0.1;
const MIN_FEED_MM_PER_MIN = 1;

export function OperationNameCell(props: {
  readonly color: string;
  readonly name: string;
}): JSX.Element {
  return (
    <td style={operationNameCellStyle}>
      <span style={operationNameInnerStyle}>
        <span
          aria-hidden="true"
          title={`Operation color ${props.color}`}
          style={{ ...swatchStyle, background: props.color }}
        />
        <span style={operationNameTextStyle}>{props.name}</span>
      </span>
    </td>
  );
}

export function ModeChipCell(props: { readonly label: string }): JSX.Element {
  return (
    <td style={tableCellStyle}>
      <span style={modeChipStyle}>{props.label}</span>
    </td>
  );
}

/** The muted one-line "everything else" row under an operation, with an
 * optional bound-material chip. */
export function OperationDetailRow(props: {
  readonly colSpan: number;
  readonly chip: { readonly label: string; readonly color: string } | null;
  readonly text: string;
}): JSX.Element {
  return (
    <tr>
      <td colSpan={props.colSpan} style={detailCellStyle}>
        {props.chip === null ? null : (
          <span style={materialChipStyle}>
            <span
              aria-hidden="true"
              style={{ ...materialChipDotStyle, background: props.chip.color }}
            />
            {props.chip.label}
          </span>
        )}
        {props.text}
      </td>
    </tr>
  );
}

export function LaserRowCells(props: {
  readonly ariaContext: string;
  readonly settings: LayerOperationSettings;
  readonly maxFeedMmPerMin: number;
  readonly onCommit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { settings } = props;
  return (
    <>
      <ReviewNumberCell
        label={`Power % for ${props.ariaContext}`}
        value={settings.power}
        min={0}
        max={PERCENT_MAX}
        step="any"
        // Keep the grayscale floor consistent, the PowerInput co-clamp rule.
        onCommit={(power) =>
          props.onCommit({ power, minPower: Math.min(settings.minPower, power) })
        }
      />
      <ReviewNumberCell
        label={`Speed mm/min for ${props.ariaContext}`}
        value={settings.speed}
        min={MIN_SPEED_MM_PER_MIN}
        max={props.maxFeedMmPerMin}
        onCommit={(speed) => props.onCommit({ speed })}
      />
      <ReviewNumberCell
        label={`Passes for ${props.ariaContext}`}
        value={settings.passes}
        min={MIN_PASSES}
        isInteger
        onCommit={(passes) => props.onCommit({ passes })}
      />
      <td style={tableCellStyle}>
        <label style={airCellLabelStyle}>
          <input
            type="checkbox"
            aria-label={`Air assist for ${props.ariaContext}`}
            title="Toggle air assist for this operation"
            checked={settings.airAssist}
            onChange={(event) => props.onCommit({ airAssist: event.target.checked })}
          />
          Air
        </label>
      </td>
    </>
  );
}

export function CncRowCells(props: {
  readonly ariaContext: string;
  readonly settings: CncLayerSettings;
  readonly maxFeedMmPerMin: number;
  readonly spindleMaxRpm: number;
  readonly onCommit: (next: CncLayerSettings) => void;
}): JSX.Element {
  const { settings } = props;
  return (
    <>
      <ReviewNumberCell
        label={`Cut depth mm for ${props.ariaContext}`}
        value={settings.depthMm}
        min={MIN_CNC_DEPTH_MM}
        step="any"
        onCommit={(depthMm) => props.onCommit({ ...settings, depthMm })}
      />
      <ReviewNumberCell
        label={`Depth per pass mm for ${props.ariaContext}`}
        value={settings.depthPerPassMm}
        min={MIN_CNC_DEPTH_MM}
        step="any"
        onCommit={(depthPerPassMm) =>
          props.onCommit(withManualCncFeedPatch(settings, { depthPerPassMm }))
        }
      />
      <ReviewNumberCell
        label={`Feed mm/min for ${props.ariaContext}`}
        value={settings.feedMmPerMin}
        min={MIN_FEED_MM_PER_MIN}
        max={props.maxFeedMmPerMin}
        onCommit={(feedMmPerMin) =>
          props.onCommit(withManualCncFeedPatch(settings, { feedMmPerMin }))
        }
      />
      <ReviewNumberCell
        label={`Plunge mm/min for ${props.ariaContext}`}
        value={settings.plungeMmPerMin}
        min={MIN_FEED_MM_PER_MIN}
        max={props.maxFeedMmPerMin}
        onCommit={(plungeMmPerMin) =>
          props.onCommit(withManualCncFeedPatch(settings, { plungeMmPerMin }))
        }
      />
      <ReviewNumberCell
        label={`Spindle RPM for ${props.ariaContext}`}
        value={settings.spindleRpm}
        min={0}
        max={props.spindleMaxRpm}
        isInteger
        onCommit={(spindleRpm) => props.onCommit(withManualCncFeedPatch(settings, { spindleRpm }))}
      />
    </>
  );
}
