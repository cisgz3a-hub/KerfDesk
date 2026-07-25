// Standard views and screenshot export (ADR-255 stage 10).
//
// Sits top-right of the viewport; the LIVE badge owns top-left. Top / Front
// / Right are the drawing views a CAD operator reaches for, Iso is the
// default three-quarter view.

import { CAMERA_PRESETS, CAMERA_PRESET_LABEL, type CameraPreset } from '../viewer3d';

const VIEW_HINT: Readonly<Record<CameraPreset, string>> = {
  iso: 'Three-quarter view',
  top: 'Look straight down (XY)',
  front: 'Look along +Y (XZ)',
  right: 'Look along -X (YZ)',
};

export function InspectorViewControls(props: {
  readonly onSelectView: (preset: CameraPreset) => void;
  readonly onCapture: () => void;
}): JSX.Element {
  return (
    <div style={wrapStyle} role="group" aria-label="View">
      {CAMERA_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          className="lf-btn"
          style={buttonStyle}
          title={VIEW_HINT[preset]}
          onClick={() => props.onSelectView(preset)}
        >
          {CAMERA_PRESET_LABEL[preset]}
        </button>
      ))}
      <button
        type="button"
        className="lf-btn"
        style={buttonStyle}
        title="Save a PNG of this view"
        onClick={props.onCapture}
      >
        PNG
      </button>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 2,
  display: 'flex',
  gap: 2,
  padding: 2,
  borderRadius: 'var(--lf-radius-lg)',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
};

const buttonStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 'var(--lf-text-xs)',
  borderRadius: 'var(--lf-radius-md)',
};
