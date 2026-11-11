// Camera direction, projection, progress following, measuring and local
// screenshot export. ADR-701: one slim toolbar over the scene, icons for the
// tools and short words for the standard views.

import { CAMERA_PRESETS, CAMERA_PRESET_LABEL, type CameraPreset } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dProjection } from '../viewer3d/camera-presets';
import { VIEWER3D_MOUSE_HINT } from '../viewer3d/viewer3d-controls';
import type { IconName } from '../kit';
import { ViewerIcon, type ViewerIconName } from './viewer-icons';
import './inspector-viewer.css';

export type InspectorCameraMode = 'manual' | 'follow' | 'auto';

const CAMERA_MODES: ReadonlyArray<{
  readonly id: InspectorCameraMode;
  readonly label: string;
  readonly icon: ViewerIconName | IconName;
  readonly hint: string;
}> = [
  { id: 'manual', label: 'Manual', icon: 'hand', hint: `Manual: ${VIEWER3D_MOUSE_HINT}` },
  {
    id: 'follow',
    label: 'Follow',
    icon: 'crosshair',
    hint: 'Follow: keep the current move in view',
  },
  {
    id: 'auto',
    label: 'Auto views',
    icon: 'orbit',
    hint: 'Auto views: follow progress and change the viewing angle',
  },
];

const VIEW_HINT: Readonly<Record<CameraPreset, string>> = {
  iso: 'Three-quarter view',
  top: 'Look straight down (XY), orthographic',
  front: 'Look along +Y (XZ), orthographic',
  right: 'Look along -X (YZ), orthographic',
};

/** The measure tool's switch; absent where the view has no toolpath to measure. */
export type MeasureSwitch = { readonly active: boolean; readonly toggle: () => void };

export function InspectorViewControls(props: {
  readonly onSelectView: (preset: CameraPreset) => void;
  readonly onCapture: () => void;
  readonly cameraMode: InspectorCameraMode;
  readonly onCameraModeChange: (mode: InspectorCameraMode) => void;
  readonly onFit: () => void;
  readonly projection: Viewer3dProjection;
  readonly onProjectionChange: (projection: Viewer3dProjection) => void;
  readonly measure?: MeasureSwitch | null;
  readonly disabled?: boolean;
}): JSX.Element {
  const ortho = props.projection === 'orthographic';
  const disabled = props.disabled ?? false;
  const { measure } = props;
  return (
    <div className="gcode-viewer-controls" aria-label="View controls">
      <div className="gcode-viewer-control-group" role="group" aria-label="Camera mode">
        {CAMERA_MODES.map((mode) => (
          <ToolButton
            key={mode.id}
            icon={mode.icon}
            label={mode.label}
            title={mode.hint}
            pressed={props.cameraMode === mode.id}
            disabled={disabled}
            onClick={() => props.onCameraModeChange(mode.id)}
          />
        ))}
      </div>
      <div className="gcode-viewer-control-group" role="group" aria-label="Standard views">
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="lf-btn gcode-viewer-tool-button gcode-viewer-tool-word"
            title={VIEW_HINT[preset]}
            disabled={disabled}
            onClick={() => props.onSelectView(preset)}
          >
            {CAMERA_PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
      <div className="gcode-viewer-control-group" role="group" aria-label="View tools">
        <ToolButton
          icon="ortho"
          label="Ortho"
          title="Orthographic view: no perspective, so sizes read true across the view"
          pressed={ortho}
          disabled={disabled}
          onClick={() => props.onProjectionChange(ortho ? 'perspective' : 'orthographic')}
        />
        <ToolButton
          icon="fit-selection"
          label="Fit"
          title="Fit the whole program in view from this direction"
          disabled={disabled}
          onClick={props.onFit}
        />
        {measure != null ? (
          <ToolButton
            icon="ruler"
            label="Measure"
            title="Measure between two points on the toolpath"
            pressed={measure.active}
            disabled={disabled}
            onClick={measure.toggle}
          />
        ) : null}
        <ToolButton
          icon="camera"
          label="Save image"
          title="Save a PNG of this view"
          disabled={disabled}
          onClick={props.onCapture}
        />
      </div>
    </div>
  );
}

function ToolButton(props: {
  readonly icon: ViewerIconName | IconName;
  readonly label: string;
  readonly title: string;
  readonly pressed?: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn gcode-viewer-tool-button"
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      {...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed })}
    >
      <ViewerIcon name={props.icon} size={16} />
    </button>
  );
}
