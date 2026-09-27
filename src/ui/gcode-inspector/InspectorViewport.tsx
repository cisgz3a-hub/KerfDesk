import type { CameraTracking, Viewer3dSceneHandle } from '../viewer3d';
// Deep imports: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dView } from '../viewer3d/camera-presets';
import { VIEWER3D_MOUSE_HINT } from '../viewer3d/viewer3d-controls';
import { InspectorMoveTip, type MovePickProps } from './InspectorMoveTip';
import { InspectorViewControls } from './InspectorViewControls';
import { InspectorViewCube } from './InspectorViewCube';
import type { PlayheadState } from './playhead';
import type { InspectorLiveProgress } from './use-inspector-live-progress';
import { useViewportCameraUi } from './use-viewport-camera-ui';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

type InspectorViewportProps = {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  readonly handleRef: React.RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly reason: string;
  readonly cameraMode: CameraTracking['mode'];
  readonly onCameraModeChange: (mode: CameraTracking['mode']) => void;
  readonly live: InspectorLiveProgress | null;
  readonly playhead: PlayheadState;
  readonly activeLine: number | null;
  /** The tool cutting at the playhead, when the program names its tools. */
  readonly toolLabel: string | null;
  readonly playing: boolean;
  readonly travelVisible: boolean;
  readonly onTravelChange: (visible: boolean) => void;
  /** Hover a move to read it, click it to go to its line (ADR-470). */
  readonly movePick?: MovePickProps;
  readonly children?: React.ReactNode;
};

export function InspectorViewport(props: InspectorViewportProps): JSX.Element {
  const { projection, moving } = useViewportCameraUi(props.handleRef, props.state);
  const manual = (action: () => void): void => {
    props.onCameraModeChange('manual');
    action();
  };
  const selectView = (view: Viewer3dView): void =>
    manual(() => props.handleRef.current?.setView(view));
  const ready = props.state === 'ready';
  return (
    <div
      className="gcode-viewer-viewport"
      data-viewer-state={props.state}
      data-moving={moving ? 'true' : 'false'}
    >
      <canvas
        ref={props.canvasRef}
        className="gcode-viewer-canvas"
        aria-label="3D G-code toolpath"
      />
      <ViewportHud
        live={props.live}
        playhead={props.playhead}
        activeLine={props.activeLine}
        toolLabel={props.toolLabel}
        playing={props.playing}
      />
      <InspectorViewControls
        cameraMode={props.cameraMode}
        onCameraModeChange={props.onCameraModeChange}
        onSelectView={selectView}
        onFit={() => manual(() => props.handleRef.current?.fitView())}
        projection={projection}
        onProjectionChange={(next) => props.handleRef.current?.setProjection(next)}
        onCapture={() => capture(props.handleRef.current)}
        disabled={!ready}
      />
      {ready ? <InspectorViewCube handleRef={props.handleRef} onSelectView={selectView} /> : null}
      {props.movePick !== undefined ? (
        <InspectorMoveTip
          {...props.movePick}
          canvasRef={props.canvasRef}
          handleRef={props.handleRef}
          enabled={ready}
          paused={moving}
        />
      ) : null}
      {props.children}
      <ViewHint
        cameraMode={props.cameraMode}
        travelVisible={props.travelVisible}
        onTravelChange={props.onTravelChange}
      />
      {props.state === 'loading' || props.state === 'preparing' ? (
        <p className="gcode-viewer-message" role="status">
          Preparing 3D view…
        </p>
      ) : null}
      {props.state === 'no-webgl' ? (
        <p className="gcode-viewer-message">
          3D view unavailable: {props.reason} The program parsed — readouts are live.
        </p>
      ) : null}
    </div>
  );
}

function ViewHint(props: {
  readonly cameraMode: CameraTracking['mode'];
  readonly travelVisible: boolean;
  readonly onTravelChange: (visible: boolean) => void;
}): JSX.Element {
  return (
    <div className="gcode-viewer-view-hint">
      <label>
        <input
          type="checkbox"
          checked={props.travelVisible}
          title="Show or hide non-cutting travel moves"
          onChange={(event) => props.onTravelChange(event.currentTarget.checked)}
        />{' '}
        Travel
      </label>
      <span>
        {props.cameraMode === 'manual'
          ? VIEWER3D_MOUSE_HINT
          : 'Following progress · Drag for manual view'}
      </span>
      <span>Faint path: program context</span>
    </div>
  );
}

function ViewportHud(props: {
  readonly live: InspectorLiveProgress | null;
  readonly playhead: PlayheadState;
  readonly activeLine: number | null;
  readonly toolLabel: string | null;
  readonly playing: boolean;
}): JSX.Element {
  const point = props.live === null ? props.playhead.point : props.live.point;
  const label = progressLabel(props.live, props.playing);
  return (
    <div className="gcode-viewer-hud" aria-label="Viewer position">
      <div className="gcode-viewer-hud-status">
        <span
          className="gcode-viewer-hud-dot"
          data-live={props.live?.active ? 'true' : 'false'}
          aria-hidden="true"
        />
        <strong className="gcode-viewer-hud-title">{label}</strong>
        {props.activeLine !== null ? <span>Line {props.activeLine + 1}</span> : null}
      </div>
      <div className="gcode-viewer-hud-detail">
        {point === null
          ? 'Position unavailable'
          : `X ${point.x.toFixed(2)}   Y ${point.y.toFixed(2)}   Z ${point.z.toFixed(2)} mm`}
      </div>
      {props.toolLabel !== null ? (
        <div className="gcode-viewer-hud-detail">Tool: {props.toolLabel}</div>
      ) : null}
      {props.live?.reason ? (
        <div className="gcode-viewer-hud-detail">{props.live.reason}</div>
      ) : null}
    </div>
  );
}

function progressLabel(live: InspectorLiveProgress | null, playing: boolean): string {
  if (live === null) return playing ? 'Playback' : 'Program preview';
  return `${live.active ? 'Live' : 'Run'} · ${live.lifecycle ?? 'unavailable'}`;
}

function capture(handle: Viewer3dSceneHandle | null): void {
  const url = handle?.captureImage();
  if (url === undefined) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gcode-view.png';
  link.click();
}
