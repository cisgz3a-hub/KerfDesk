import { JOB_ORIGIN_ANCHORS, type JobOriginAnchor, type JobStartMode } from '../../core/job';
import { type JobPlacementSettings } from '../job-placement';
import { useStore } from '../state';

const START_FROM_LABELS: Readonly<Record<JobStartMode, string>> = {
  absolute: 'Absolute Coordinates',
  'current-position': 'Current Position',
  'user-origin': 'User Origin',
};

const ANCHOR_LABELS: Readonly<Record<JobOriginAnchor, string>> = {
  'back-left': 'BL',
  'back-center': 'BC',
  'back-right': 'BR',
  'center-left': 'CL',
  center: 'C',
  'center-right': 'CR',
  'front-left': 'FL',
  'front-center': 'FC',
  'front-right': 'FR',
};

export function JobPlacementControls(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element {
  const placement = useStore((s) => s.jobPlacement);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const busy = props.disabled || props.streaming;
  return (
    <div style={placementRowStyle}>
      <label style={placementLabelStyle}>
        <span>Start from</span>
        <select
          aria-label="Start from"
          value={placement.startFrom}
          disabled={busy}
          onChange={(e) => setJobPlacement({ startFrom: e.currentTarget.value as JobStartMode })}
        >
          {Object.entries(START_FROM_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <AnchorPicker placement={placement} disabled={busy || placement.startFrom === 'absolute'} />
    </div>
  );
}

function AnchorPicker(props: {
  readonly placement: JobPlacementSettings;
  readonly disabled: boolean;
}): JSX.Element {
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  return (
    <div aria-label="Job origin" style={anchorGridStyle}>
      {JOB_ORIGIN_ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          aria-label={`Job origin ${anchor}`}
          aria-pressed={props.placement.anchor === anchor}
          disabled={props.disabled}
          title={`Job origin: ${anchor}`}
          onClick={() => setJobPlacement({ anchor })}
          style={anchorButtonStyle(props.placement.anchor === anchor)}
        >
          {ANCHOR_LABELS[anchor]}
        </button>
      ))}
    </div>
  );
}

const placementRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const placementLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const anchorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 26px)',
  gap: 2,
};

function anchorButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 22,
    padding: 0,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    background: active ? 'var(--lf-accent)' : undefined,
    color: active ? '#fff' : undefined,
  };
}
