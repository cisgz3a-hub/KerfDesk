import { JOB_ORIGIN_ANCHORS, type JobOriginAnchor, type JobStartMode } from '../../core/job';
import { controlHelp } from '../help/help-topics';
import { type JobPlacementSettings } from '../job-placement';
import { useStore } from '../state';
import { sectionCaptionStyle } from './JobControls.styles';
import { LineBurnStartField } from './LineBurnStartField';

const START_FROM_LABELS: Readonly<Record<JobStartMode, string>> = {
  absolute: 'Absolute Coordinates',
  'user-origin': 'User Origin',
  'current-position': 'Current Position',
  'verified-origin': 'Verified Origin',
};

// What each mode does with the design's place on the canvas, which the four
// names alone never said (UX audit U2-P3-7): under User Origin a design at
// canvas X 110 framed at the head.
export const START_FROM_HINTS: Readonly<Record<JobStartMode, string>> = {
  absolute:
    "Burns where the design sits on the bed, measured from the machine's own zero, which is right only after Home.",
  'user-origin':
    'Burns from the origin you set with Set origin here. Where the design sits on the canvas does not matter; Job origin picks the point of the design that goes there.',
  'current-position':
    'Burns from wherever the head is when you Frame. Where the design sits on the canvas does not matter; Job origin picks the point of the design that goes there.',
  'verified-origin':
    'Burns from an origin you set by hand and checked. Where the design sits on the canvas does not matter; Job origin picks the point of the design that goes there.',
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
  const lineStartRegion = useStore((s) => s.project.optimization.lineStartRegion);
  const setProjectOptimization = useStore((s) => s.setProjectOptimization);
  // Placement and output scope are compile settings, not controller commands.
  // Keep them editable while disconnected so Current Position can be changed
  // to Absolute for offline export; only an active machine operation locks them.
  const busy = props.streaming;
  return (
    <div style={placementStackStyle}>
      <span className="lf-placement-heading" style={sectionCaptionStyle}>
        Placement
      </span>
      <div
        className="lf-placement-fields"
        style={{ ...placementStackStyle, display: 'var(--lf-placement-display, flex)' }}
      >
        <label className="lf-placement-start" style={placementLabelStyle}>
          <span style={fieldNameStyle}>Start from</span>
          <select
            aria-label="Start from"
            className="lf-select"
            style={startFromSelectStyle}
            value={placement.startFrom}
            disabled={busy}
            title="Choose whether the job uses absolute machine coordinates, current head position, the saved user origin, or a hand-set verified origin. Every ordinary Start requires the exact completed Frame."
            onChange={(e) => setJobPlacement({ startFrom: e.currentTarget.value as JobStartMode })}
          >
            {Object.entries(START_FROM_LABELS).map(([value, label]) => (
              <option key={value} value={value} title={START_FROM_HINTS[value as JobStartMode]}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="lf-placement-anchor" style={anchorRowStyle}>
          <AnchorPicker
            placement={placement}
            disabled={busy || placement.startFrom === 'absolute'}
          />
          <span style={fieldNameStyle}>Job origin</span>
        </div>
        <LineBurnStartField
          value={lineStartRegion}
          disabled={busy}
          onChange={(value) => setProjectOptimization({ lineStartRegion: value })}
        />
      </div>
      <p className="lf-placement-mode-hint" style={modeHintStyle}>
        {START_FROM_HINTS[placement.startFrom]}
      </p>
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
          className="lf-checkbox"
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
            className="lf-checkbox"
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
          className="lf-btn"
          aria-label={`Job origin ${anchor}`}
          aria-pressed={props.placement.anchor === anchor}
          disabled={props.disabled}
          title={`Job origin: ${anchor}`}
          onClick={() => setJobPlacement({ anchor })}
          style={anchorButtonStyle}
        >
          {ANCHOR_LABELS[anchor]}
        </button>
      ))}
    </div>
  );
}

const placementStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const placementLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
// The select stretches to the rail edge so the placement block forms one
// column of aligned controls instead of a short field floating mid-row.
const startFromSelectStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const modeHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--lf-text-sm)',
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
const fieldNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
// Caption sits beside the grid — without it the nine two-letter buttons read
// as a mystery keypad instead of LightBurn's job-origin anchor picker.
const anchorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
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
const anchorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 26px)',
  gap: 2,
};

// Fixed compact cells; the pressed (active) fill comes from the design-system
// rule .lf-btn[aria-pressed='true'] so hover/disabled states stay consistent.
const anchorButtonStyle: React.CSSProperties = {
  width: 26,
  height: 22,
  padding: 0,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
};
