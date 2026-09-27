// The per-row cell sets for the Job Review artwork-settings table: the
// editable core numbers for laser operations, read-only CNC operation values,
// plus the shared name / mode-chip / detail-line cells. CNC changes belong in
// Artwork settings so this remains a review surface.

import {
  cutTypeLabel,
  type CncCutType,
  type CncLayerSettings,
  type LayerOperationSettings,
} from '../../../core/scene';
import type { CompiledReliefFacts } from './job-review-detail-facts';
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
import { pushFeedCeilingToast } from '../../layers/feed-ceiling';
import { ReviewNumberCell } from './ReviewNumberCell';

const PERCENT_MAX = 100;
const MIN_SPEED_MM_PER_MIN = 1;
const MIN_PASSES = 1;

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

export function ModeChipCell(props: {
  readonly label: string;
  readonly title?: string;
}): JSX.Element {
  return (
    <td style={tableCellStyle}>
      <span style={modeChipStyle} title={props.title}>
        {props.label}
      </span>
    </td>
  );
}

/** The CNC Cut chip: the operation's cut type, or Relief when the compiled job
 * cuts only reliefs, since that cut type then reaches no shape. */
export function CncCutCell(props: {
  readonly cutType: CncCutType;
  readonly relief: CompiledReliefFacts | undefined;
}): JSX.Element {
  const label = cutTypeLabel(props.cutType);
  if (!cutsOnlyReliefs(props.relief)) return <ModeChipCell label={label} />;
  return (
    <ModeChipCell
      label="Relief"
      title={`This operation cuts only reliefs. Its cut type, ${label}, applies to other shapes only.`}
    />
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
        onClamp={() => pushFeedCeilingToast(props.maxFeedMmPerMin)}
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

type CncRowCellsProps = {
  readonly ariaContext: string;
  readonly settings: CncLayerSettings;
  // What the compiled job cut for the operation's reliefs (ADR-224 Amendment 3).
  readonly relief: CompiledReliefFacts | undefined;
  readonly actualVCarveDepthMm?: number;
};

export function CncRowCells(props: CncRowCellsProps): JSX.Element {
  const { settings } = props;
  return (
    <>
      <CncDepthCell {...props} />
      <ReadOnlyNumberCell
        label={`Depth per pass mm for ${props.ariaContext}`}
        value={settings.depthPerPassMm}
      />
      <ReadOnlyNumberCell
        label={`Feed mm/min for ${props.ariaContext}`}
        value={settings.feedMmPerMin}
      />
      <ReadOnlyNumberCell
        label={`Plunge mm/min for ${props.ariaContext}`}
        value={settings.plungeMmPerMin}
      />
      <ReadOnlyNumberCell
        label={`Spindle RPM for ${props.ariaContext}`}
        value={settings.spindleRpm}
      />
    </>
  );
}

// Depth mm shows Cut depth unless no shape is cut to it. A flowing V-carve's
// depth comes from the artwork width and bit (ADR-285), and an operation that
// cuts only reliefs takes each relief's own depth (ADR-224 Amendment 4), so
// both show the deepest compiled pass instead.
function CncDepthCell(props: CncRowCellsProps): JSX.Element {
  if (cutsOnlyReliefs(props.relief)) {
    return (
      <ActualDepthCell
        ariaContext={props.ariaContext}
        title="Deepest compiled relief pass. Depth comes from each relief, not from Cut depth, and roughing leaves the Rough allowance."
        depthMm={props.relief.maxDepthMm}
      />
    );
  }
  if (props.settings.cutType === 'v-carve' && props.settings.vCarveFlatDepthEnabled === false) {
    return (
      <ActualDepthCell
        ariaContext={props.ariaContext}
        title="Flowing V-carve depth is calculated from the artwork width and selected bit"
        depthMm={props.actualVCarveDepthMm}
      />
    );
  }
  return (
    <ReadOnlyNumberCell
      label={`Cut depth mm for ${props.ariaContext}`}
      value={props.settings.depthMm}
    />
  );
}

function ActualDepthCell(props: {
  readonly ariaContext: string;
  readonly title: string;
  readonly depthMm: number | undefined;
}): JSX.Element {
  return (
    <td style={tableCellStyle}>
      <output
        aria-label={`Actual compiled max depth mm for ${props.ariaContext}`}
        title={props.title}
      >
        {props.depthMm === undefined ? 'Pending' : formatDepth(props.depthMm)}
      </output>
    </td>
  );
}

// An operation whose compiled job cut reliefs and nothing else: its cut type
// and Cut depth reach no shape (ADR-224 Amendment 4).
function cutsOnlyReliefs(relief: CompiledReliefFacts | undefined): relief is CompiledReliefFacts {
  return relief?.cutsOtherShapes === false;
}

function ReadOnlyNumberCell(props: {
  readonly label: string;
  readonly value: number;
}): JSX.Element {
  return (
    <td style={tableCellStyle}>
      <output aria-label={props.label}>{formatNumber(props.value)}</output>
    </td>
  );
}

function formatDepth(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} mm actual`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}
