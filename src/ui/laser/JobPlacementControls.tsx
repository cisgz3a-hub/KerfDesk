import { JOB_ORIGIN_ANCHORS, type JobOriginAnchor, type JobStartMode } from '../../core/job';
import { controlHelp } from '../help/help-topics';
import { type JobPlacementSettings } from '../job-placement';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';

const START_FROM_LABELS: Readonly<Record<JobStartMode, string>> = {
  absolute: 'Absolute Coordinates',
  'current-position': 'Current Position',
  'user-origin': 'User Origin',
  'verified-origin': 'Verified Origin',
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

const CUT_SELECTED_HELP_ID = 'control:laser.output-scope.cut-selected';
const SELECTION_ORIGIN_HELP_ID = 'control:laser.output-scope.selection-origin';

export function JobPlacementControls(props: { readonly streaming: boolean }): JSX.Element {
  const placement = useStore((s) => s.jobPlacement);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const cameraPlacementActive = useCameraStore((s) => s.placementActive);
  // Placement and output scope are compile settings, not controller commands.
  // Keep them editable while disconnected so Current Position can be changed
  // to Absolute for offline export; only an active machine operation locks them.
  const busy = props.streaming;
  return (
    <div style={placementStackStyle}>
      <div style={placementRowStyle}>
        <label style={placementLabelStyle}>
          <span>Start from</span>
          <select
            aria-label="Start from"
            value={placement.startFrom}
            disabled={busy || cameraPlacementActive}
            title={
              cameraPlacementActive
                ? 'Camera placement is aligned to the physical bed, so Absolute Coordinates is required. Exit camera placement in the Camera panel to use another origin mode.'
                : 'Choose whether the job uses absolute machine coordinates, current head position, the saved user origin, or a hand-set verified origin (ordinary no-homing placement is size-checked; Frame remains optional).'
            }
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
      {cameraPlacementActive ? (
        <div role="status" style={cameraPlacementNoteStyle}>
          Camera placement locks Absolute Coordinates so the job cannot shift away from the image.
        </div>
      ) : null}
      <OutputScopeControls placement={placement} disabled={busy} />
    </div>
  );
}

function OutputScopeControls(props: {
  readonly placement: JobPlacementSettings;
  readonly disabled: boolean;
}): JSX.Element {
  const scope = useStore((s) => s.outputScopeSettings);
  const setScope = useStore((s) => s.setOutputScopeSettings);
  const showSelectionAnchor = scope.cutSelectedGraphics && props.placement.startFrom !== 'absolute';
  return (
    <div style={scopeRowStyle}>
      <label style={scopeLabelStyle}>
        <input
          type="checkbox"
          aria-label="Selected artwork only"
          checked={scope.cutSelectedGraphics}
          disabled={props.disabled}
          onChange={(e) => setScope({ cutSelectedGraphics: e.currentTarget.checked })}
          title={controlHelp(CUT_SELECTED_HELP_ID)}
          data-help-id={CUT_SELECTED_HELP_ID}
        />
        <span>Selected artwork only</span>
      </label>
      {showSelectionAnchor && (
        <label style={scopeLabelStyle}>
          <input
            type="checkbox"
            aria-label="Anchor from selected artwork"
            checked={scope.useSelectionOrigin}
            disabled={props.disabled}
            onChange={(e) => setScope({ useSelectionOrigin: e.currentTarget.checked })}
            title={controlHelp(SELECTION_ORIGIN_HELP_ID)}
            data-help-id={SELECTION_ORIGIN_HELP_ID}
          />
          <span>Anchor from selected artwork</span>
        </label>
      )}
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
const placementStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const placementLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const scopeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  fontSize: 12,
};
const scopeLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};
const cameraPlacementNoteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-warning-fg)',
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
    color: active ? 'var(--lf-on-fill)' : undefined,
  };
}
