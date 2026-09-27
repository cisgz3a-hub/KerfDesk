// Camera direction, projection, progress following and local screenshot export.

import { CAMERA_PRESETS, CAMERA_PRESET_LABEL, type CameraPreset } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dProjection } from '../viewer3d/camera-presets';
import './inspector-viewer.css';

export type InspectorCameraMode = 'manual' | 'follow' | 'auto';

const CAMERA_MODES: ReadonlyArray<{
  readonly id: InspectorCameraMode;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: 'manual', label: 'Manual', hint: 'Orbit, pan and zoom freely' },
  { id: 'follow', label: 'Follow', hint: 'Keep the current move in view' },
  {
    id: 'auto',
    label: 'Auto views',
    hint: 'Follow progress and automatically change viewing angle',
  },
];

const VIEW_HINT: Readonly<Record<CameraPreset, string>> = {
  iso: 'Three-quarter view',
  top: 'Look straight down (XY), orthographic',
  front: 'Look along +Y (XZ), orthographic',
  right: 'Look along -X (YZ), orthographic',
};

export function InspectorViewControls(props: {
  readonly onSelectView: (preset: CameraPreset) => void;
  readonly onCapture: () => void;
  readonly cameraMode: InspectorCameraMode;
  readonly onCameraModeChange: (mode: InspectorCameraMode) => void;
  readonly onFit: () => void;
  readonly projection: Viewer3dProjection;
  readonly onProjectionChange: (projection: Viewer3dProjection) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const ortho = props.projection === 'orthographic';
  return (
    <div className="gcode-viewer-controls" aria-label="View controls">
      <div className="gcode-viewer-control-row" role="group" aria-label="Camera mode">
        <span className="gcode-viewer-control-label">Camera</span>
        {CAMERA_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className="lf-btn gcode-viewer-button"
            aria-pressed={props.cameraMode === mode.id}
            title={mode.hint}
            disabled={props.disabled}
            onClick={() => props.onCameraModeChange(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="gcode-viewer-control-row" role="group" aria-label="Standard views and export">
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="lf-btn gcode-viewer-button"
            title={VIEW_HINT[preset]}
            disabled={props.disabled}
            onClick={() => props.onSelectView(preset)}
          >
            {CAMERA_PRESET_LABEL[preset]}
          </button>
        ))}
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          aria-pressed={ortho}
          title="Orthographic view: no perspective, so sizes read true across the view"
          disabled={props.disabled}
          onClick={() => props.onProjectionChange(ortho ? 'perspective' : 'orthographic')}
        >
          Ortho
        </button>
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          title="Fit the whole program in view from this direction"
          disabled={props.disabled}
          onClick={props.onFit}
        >
          Fit
        </button>
        <button
          type="button"
          className="lf-btn gcode-viewer-button"
          title="Save a PNG of this view"
          disabled={props.disabled}
          onClick={props.onCapture}
        >
          PNG
        </button>
      </div>
    </div>
  );
}
