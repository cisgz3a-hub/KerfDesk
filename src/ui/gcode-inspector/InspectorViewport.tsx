import type { CameraTracking, CameraPreset, Viewer3dSceneHandle } from '../viewer3d';
import { InspectorViewControls } from './InspectorViewControls';
import type { PlayheadState } from './playhead';
import type { InspectorLiveProgress } from './use-inspector-live-progress';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

export function InspectorViewport(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  readonly handleRef: React.RefObject<Viewer3dSceneHandle | null>;
  readonly state: Viewer3dSceneState;
  readonly reason: string;
  readonly cameraMode: CameraTracking['mode'];
  readonly onCameraModeChange: (mode: CameraTracking['mode']) => void;
  readonly live: InspectorLiveProgress | null;
  readonly playhead: PlayheadState;
  readonly activeLine: number | null;
  readonly playing: boolean;
  readonly travelVisible: boolean;
  readonly onTravelChange: (visible: boolean) => void;
  readonly children?: React.ReactNode;
}): JSX.Element {
  const manual = (action: () => void): void => {
    props.onCameraModeChange('manual');
    action();
  };
  return (
    <div className="gcode-viewer-viewport" data-viewer-state={props.state}>
      <canvas
        ref={props.canvasRef}
        className="gcode-viewer-canvas"
        aria-label="3D G-code toolpath"
      />
      <ViewportHud
        live={props.live}
        playhead={props.playhead}
        activeLine={props.activeLine}
        playing={props.playing}
      />
      <InspectorViewControls
        cameraMode={props.cameraMode}
        onCameraModeChange={props.onCameraModeChange}
        onSelectView={(preset: CameraPreset) =>
          manual(() => props.handleRef.current?.setView(preset))
        }
        onFit={() => manual(() => props.handleRef.current?.setView('iso'))}
        onCapture={() => capture(props.handleRef.current)}
        disabled={props.state !== 'ready'}
      />
      {props.children}
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
            ? 'Drag to orbit · Scroll to zoom'
            : 'Following progress · Drag for manual view'}
        </span>
        <span>Faint path: program context</span>
      </div>
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

function ViewportHud(props: {
  readonly live: InspectorLiveProgress | null;
  readonly playhead: PlayheadState;
  readonly activeLine: number | null;
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
