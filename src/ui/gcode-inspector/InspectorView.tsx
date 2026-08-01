// InspectorView — the Inspector's working surface: 3D viewport, transport,
// source pane and readouts (ADR-255 stage 9b extraction).
//
// Extracted from the dialog so the SAME view can render inline as a canvas
// mode, not only inside a modal. The dialog is now just a frame around it.

import { useMemo, useRef, useState } from 'react';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { findProgramIssues, type GcodeRenderModel } from '../../core/gcode-view';
import {
  directionArrows,
  resolveViewer3dTheme,
  type CameraPreset,
  type Viewer3dSceneHandle,
} from '../viewer3d';
import { InspectorSidebar } from './InspectorSidebar';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import { InspectorSourcePane } from './InspectorSourcePane';
import { InspectorTimeline } from './InspectorTimeline';
import { InspectorViewControls } from './InspectorViewControls';
import { lensColorFn, type LensId } from './lenses';
import { playheadAtTime, secondsAtLine } from './playhead';
import { useInspectorPlayback } from './use-inspector-playback';
import { useLiveMachine, type LiveMachine } from './use-live-machine';
import { useSceneSync } from './use-scene-sync';
import { useViewer3dScene } from './use-viewer3d-scene';

// GRBL defaults. An opened file may not belong to the current machine, so the
// Inspector times it against stock kinematics rather than silently borrowing
// the connected device's — the timeline is labelled as an estimate.
const INSPECTOR_LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

/**
 * 'full' is the in-depth screen: 3D + source pane + readouts + health.
 * 'preview' is the canvas mode: the 3D toolpath and its transport only —
 * a look at the program, not a workbench.
 */
export type InspectorVariant = 'full' | 'preview';

type InspectorViewProps =
  | {
      readonly model: GcodeRenderModel;
      readonly source: GcodeInspectionSource;
      readonly sourceIndex: GcodeSourceLineIndex;
      readonly variant?: 'full';
    }
  | {
      readonly model: GcodeRenderModel;
      readonly variant: 'preview';
    };

export function InspectorView(props: InspectorViewProps): JSX.Element {
  const full = (props.variant ?? 'full') === 'full';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [travelVisible, setTravelVisible] = useState(true);
  const [lens, setLens] = useState<LensId>('kind');
  const [arrowsVisible, setArrowsVisible] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const theme = useMemo(() => resolveViewer3dTheme(canvasRef.current), []);
  const { model } = props;
  const { handleRef, state, reason } = useViewer3dScene(canvasRef, model);
  const { time, playback, playhead, findings, atEnd, colorOf, arrows, activeLine } =
    useInspectorDerived(model, lens, theme, arrowsVisible);
  const live = useLiveMachine();

  useSceneSync({
    handleRef,
    state,
    playhead: atEnd ? null : playhead,
    colorOf,
    live: live.point,
    arrows,
  });

  // source -> 3D: select the line, and move the playhead to its first move.
  // Modal/event lines emit no motion, so the playhead stays put rather than
  // jumping somewhere arbitrary — the selection still updates.
  const locateLine = (line: number): void => {
    setSelectedLine(line);
    const target = secondsAtLine(model, time.segTimeEndSec, line);
    if (target !== null) playback.setRouteMm(target);
  };

  return (
    <div style={bodyRowStyle}>
      <div style={viewColumnStyle}>
        {full ? <SourceToggle visible={sourceVisible} onToggle={setSourceVisible} /> : null}
        <Viewport
          canvasRef={canvasRef}
          live={live}
          handleRef={handleRef}
          state={state}
          reason={reason}
        />
        <InspectorTimeline playback={playback} totalRouteMm={time.motionSeconds} />
      </div>
      {props.variant !== 'preview' && sourceVisible ? (
        <InspectorSourcePane
          source={props.source}
          sourceIndex={props.sourceIndex}
          categories={model.lineCategories}
          activeLine={activeLine}
          selectedLine={selectedLine}
          onSelectLine={locateLine}
        />
      ) : null}
      {full ? (
        <InspectorSidebar
          model={model}
          theme={theme}
          playhead={playhead}
          time={time}
          findings={findings}
          lens={lens}
          onLensChange={setLens}
          arrowsVisible={arrowsVisible}
          onArrowsVisibleChange={setArrowsVisible}
          travelVisible={travelVisible}
          onTravelVisibleChange={(visible) => {
            setTravelVisible(visible);
            handleRef.current?.setTravelVisible(visible);
          }}
          onLocateLine={locateLine}
        />
      ) : null}
    </div>
  );
}

/** Everything derived from the program: planner time, playhead, findings,
 * lens colours and the arrow overlay. Extracted to keep InspectorView inside
 * the function-size cap. */
function useInspectorDerived(
  model: GcodeRenderModel,
  lens: LensId,
  theme: ReturnType<typeof resolveViewer3dTheme>,
  arrowsVisible: boolean,
): {
  readonly time: ReturnType<typeof buildProgramTime>;
  readonly playback: ReturnType<typeof useInspectorPlayback>;
  readonly playhead: ReturnType<typeof playheadAtTime>;
  readonly findings: ReturnType<typeof findProgramIssues>;
  readonly atEnd: boolean;
  readonly colorOf: ReturnType<typeof lensColorFn>;
  readonly arrows: ReturnType<typeof directionArrows> | null;
  /** 3D -> source: the line whose move the playhead is executing. */
  readonly activeLine: number | null;
} {
  // Planner-true seconds: the same kinematics Job Review estimates with.
  const time = useMemo(() => buildProgramTime(model, INSPECTOR_LIMITS), [model]);
  const playback = useInspectorPlayback(time.motionSeconds);
  const playhead = useMemo(
    () => playheadAtTime(model, time.segTimeEndSec, playback.routeMm),
    [model, time, playback.routeMm],
  );
  const findings = useMemo(() => findProgramIssues(model), [model]);
  const colorOf = useMemo(() => lensColorFn(model, time, lens, theme), [model, time, lens, theme]);
  // Cut direction is invisible without these: climb vs conventional.
  const arrows = useMemo(
    () => (arrowsVisible ? directionArrows(model) : null),
    [model, arrowsVisible],
  );
  return {
    time,
    playback,
    playhead,
    findings,
    // Fully-drawn playhead = show everything, so the scene never hides the
    // tail segment to floating-point rounding.
    atEnd: playback.routeMm >= time.motionSeconds,
    colorOf,
    arrows,
    activeLine: playhead.segmentIndex < 0 ? null : (model.segLine[playhead.segmentIndex] ?? null),
  };
}

function Viewport(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement>;
  readonly live: LiveMachine;
  readonly handleRef: React.RefObject<Viewer3dSceneHandle | null>;
  readonly state: string;
  readonly reason: string;
}): JSX.Element {
  return (
    <div style={viewportStyle}>
      <canvas ref={props.canvasRef} style={canvasStyle} />
      {props.live.streaming ? <LiveBadge live={props.live} /> : null}
      <InspectorViewControls
        onSelectView={(preset: CameraPreset) => props.handleRef.current?.setView(preset)}
        onCapture={() => {
          const url = props.handleRef.current?.captureImage();
          if (url !== undefined) downloadPng(url);
        }}
      />
      {props.state === 'no-webgl' ? (
        <p style={messageStyle}>
          3D view unavailable: {props.reason} The program parsed — readouts are live.
        </p>
      ) : null}
    </div>
  );
}

// Shown only while a job is actually streaming. Reports what the controller
// said — never an inference — so the operator can trust it against the
// machine in front of them.
function LiveBadge(props: { readonly live: LiveMachine }): JSX.Element {
  const { live } = props;
  const percent =
    live.progress === null || live.progress.total <= 0
      ? null
      : Math.round((live.progress.completed / live.progress.total) * 100);
  return (
    <div style={liveBadgeStyle} role="status" aria-label="Live machine">
      <span style={liveDotStyle} aria-hidden="true" />
      <strong>LIVE</strong>
      {live.state === null ? null : <span>{live.state}</span>}
      {percent === null ? null : <span>{percent}%</span>}
      {live.point === null ? (
        <span style={liveMutedStyle}>position not reported</span>
      ) : (
        <span style={liveMonoStyle}>
          X{live.point.x.toFixed(1)} Y{live.point.y.toFixed(1)} Z{live.point.z.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// The operator asked for this frame, so handing back a file is the whole
// point; nothing leaves the machine.
function downloadPng(dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'gcode-view.png';
  link.click();
}

function SourceToggle(props: {
  readonly visible: boolean;
  readonly onToggle: (update: (visible: boolean) => boolean) => void;
}): JSX.Element {
  return (
    <div style={sourceToggleRowStyle}>
      <button
        type="button"
        className="lf-btn"
        title="Show or hide the program source"
        aria-pressed={props.visible}
        style={sourceToggleStyle}
        onClick={() => props.onToggle((visible) => !visible)}
      >
        {props.visible ? 'Hide source' : 'Show source'}
      </button>
    </div>
  );
}

const bodyRowStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const viewColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
};

const viewportStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
};

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

const messageStyle: React.CSSProperties = {
  margin: 12,
};

const liveBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 10px',
  borderRadius: 'var(--lf-radius-lg)',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 'var(--lf-text-sm)',
};

const liveDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--lf-success)',
};

const liveMonoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, monospace',
  fontVariantNumeric: 'tabular-nums',
};

const liveMutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };

const sourceToggleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '4px 8px 0',
};

const sourceToggleStyle: React.CSSProperties = {
  padding: '1px 8px',
  fontSize: 'var(--lf-text-xs)',
};
