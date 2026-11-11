// The viewer's header (ADR-426 split from InspectorView; ADR-701 layout): what
// the job is at a glance on the left (its time, size and cut length), and the
// look and layout switches on the right. One row, so the 3D view keeps the
// height.

// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { VIEWER3D_LOOKS, VIEWER3D_LOOK_LABEL, type Viewer3dLook } from '../viewer3d/viewer3d-look';
import { formatClock } from './InspectorTimeline';
import { ViewerIcon, type ViewerIconName } from './viewer-icons';

const LOOK_HINT: Readonly<Record<Viewer3dLook, string>> = {
  classic: 'The familiar look: pale lines on a plain grid',
  studio: 'Lit tool model, job box with sizes, and colours that match the legend exactly',
};

export type InspectorLayout = {
  readonly full: boolean;
  readonly sourceVisible: boolean;
  readonly onSourceToggle: () => void;
  readonly readoutsVisible: boolean;
  readonly onReadoutsToggle: () => void;
  readonly fullWindow: {
    readonly supported: boolean;
    readonly active: boolean;
    readonly toggle: () => void;
  };
};

/** The job at a glance: motion time, footprint and cut length. */
export type InspectorJobStats = {
  readonly seconds: number;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
  readonly cutMm: number;
};

const MM_PER_METRE = 1000;

export function InspectorViewerHeader(props: {
  readonly liveMode: boolean;
  readonly liveMatched: boolean;
  readonly onFollowLiveToggle: () => void;
  readonly look: Viewer3dLook;
  readonly onLookChange: (look: Viewer3dLook) => void;
  readonly layout: InspectorLayout;
  readonly stats: InspectorJobStats;
  /** What the host puts first in the row, such as the canvas view's name. */
  readonly lead?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="gcode-viewer-header">
      <div className="gcode-viewer-heading">
        {props.lead}
        {props.liveMode ? (
          <span className="gcode-viewer-live-note">
            <span className="gcode-viewer-status-dot" data-live="true" aria-hidden="true" />
            Watching the started program
          </span>
        ) : null}
        <JobStats stats={props.stats} />
      </div>
      <div className="gcode-viewer-header-actions">
        {props.liveMatched ? (
          <button
            type="button"
            className="lf-btn gcode-viewer-text-button"
            aria-pressed={props.liveMode}
            title="Switch between reported machine progress and local preview playback"
            onClick={props.onFollowLiveToggle}
          >
            {props.liveMode ? 'Preview playback' : 'Watch live run'}
          </button>
        ) : null}
        <LookSwitch look={props.look} onLookChange={props.onLookChange} />
        <LayoutToggles layout={props.layout} />
      </div>
    </div>
  );
}

function JobStats({ stats }: { readonly stats: InspectorJobStats }): JSX.Element {
  const size =
    stats.widthMm === null || stats.heightMm === null
      ? null
      : `${mm(stats.widthMm)} × ${mm(stats.heightMm)} mm`;
  return (
    <ul className="gcode-viewer-stats" aria-label="Job summary">
      <li title="Estimated motion time">
        <ViewerIcon name="play" size={12} />
        {formatClock(stats.seconds)}
      </li>
      {size !== null ? (
        <li title="Width × height of what the program cuts">
          <ViewerIcon name="square" size={12} />
          {size}
        </li>
      ) : null}
      <li title="Total cutting length">
        <ViewerIcon name="pen" size={12} />
        {length(stats.cutMm)} cut
      </li>
    </ul>
  );
}

function mm(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function length(valueMm: number): string {
  return valueMm >= MM_PER_METRE
    ? `${(valueMm / MM_PER_METRE).toFixed(1)} m`
    : `${valueMm.toFixed(0)} mm`;
}

function LookSwitch(props: {
  readonly look: Viewer3dLook;
  readonly onLookChange: (look: Viewer3dLook) => void;
}): JSX.Element {
  return (
    <div className="gcode-viewer-segmented" role="group" aria-label="3D look">
      {VIEWER3D_LOOKS.map((look) => (
        <button
          key={look}
          type="button"
          className="lf-btn gcode-viewer-button"
          aria-pressed={props.look === look}
          title={LOOK_HINT[look]}
          onClick={() => props.onLookChange(look)}
        >
          {VIEWER3D_LOOK_LABEL[look]}
        </button>
      ))}
    </div>
  );
}

function LayoutToggles({ layout }: { readonly layout: InspectorLayout }): JSX.Element {
  const { fullWindow } = layout;
  return (
    <div className="gcode-viewer-header-icons">
      {layout.full ? (
        <>
          <HeaderToggle
            icon="code"
            label={layout.sourceVisible ? 'Hide source' : 'Show source'}
            pressed={layout.sourceVisible}
            title="Show or hide the G-code source beside the 3D view"
            onClick={layout.onSourceToggle}
          />
          <HeaderToggle
            icon="panel-right"
            label={layout.readoutsVisible ? 'Hide readouts' : 'Show readouts'}
            pressed={layout.readoutsVisible}
            title="Show or hide the position, colour and program readouts"
            onClick={layout.onReadoutsToggle}
          />
        </>
      ) : null}
      {fullWindow.supported ? (
        <HeaderToggle
          icon={fullWindow.active ? 'minimize' : 'maximize'}
          label={fullWindow.active ? 'Exit full window' : 'Full window'}
          pressed={fullWindow.active}
          title="Fill the screen with the 3D view (Esc to leave)"
          onClick={fullWindow.toggle}
        />
      ) : null}
    </div>
  );
}

function HeaderToggle(props: {
  readonly icon: ViewerIconName | 'panel-right';
  readonly label: string;
  readonly pressed: boolean;
  readonly title: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn gcode-viewer-icon-button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={props.title}
      onClick={props.onClick}
    >
      <ViewerIcon name={props.icon} size={16} />
    </button>
  );
}
