// The Inspector's header (ADR-426 split from InspectorView): live/preview
// switch, the Classic / Studio look, and the layout toggles.

// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import { VIEWER3D_LOOKS, VIEWER3D_LOOK_LABEL, type Viewer3dLook } from '../viewer3d/viewer3d-look';

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

export function InspectorViewerHeader(props: {
  readonly liveMode: boolean;
  readonly liveMatched: boolean;
  readonly onFollowLiveToggle: () => void;
  readonly look: Viewer3dLook;
  readonly onLookChange: (look: Viewer3dLook) => void;
  readonly layout: InspectorLayout;
}): JSX.Element {
  return (
    <div className="gcode-viewer-header">
      <div className="gcode-viewer-heading">
        <span className="gcode-viewer-eyebrow">G-CODE / 3D</span>
        <span className="gcode-viewer-subtitle">
          {props.liveMode ? 'Watching the started program' : 'Explore the toolpath'}
        </span>
      </div>
      <div className="gcode-viewer-header-actions">
        {props.liveMatched ? (
          <button
            type="button"
            className="lf-btn"
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
  return (
    <>
      {layout.full ? (
        <>
          <button
            type="button"
            className="lf-btn"
            aria-pressed={layout.readoutsVisible}
            title="Show or hide the position, colour and program readouts"
            onClick={layout.onReadoutsToggle}
          >
            {layout.readoutsVisible ? 'Hide readouts' : 'Show readouts'}
          </button>
          <button
            type="button"
            className="lf-btn"
            aria-pressed={layout.sourceVisible}
            title="Show or hide the G-code source beside the 3D view"
            onClick={layout.onSourceToggle}
          >
            {layout.sourceVisible ? 'Hide source' : 'Show source'}
          </button>
        </>
      ) : null}
      {layout.fullWindow.supported ? (
        <button
          type="button"
          className="lf-btn"
          aria-pressed={layout.fullWindow.active}
          title="Fill the screen with the 3D view (Esc to leave)"
          onClick={layout.fullWindow.toggle}
        >
          {layout.fullWindow.active ? 'Exit full window' : 'Full window'}
        </button>
      ) : null}
    </>
  );
}
