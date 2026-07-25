// InspectorView — the Inspector's working surface: 3D viewport, transport,
// source pane and readouts (ADR-255 stage 9b extraction).
//
// Extracted from the dialog so the SAME view can render inline as a canvas
// mode, not only inside a modal. The dialog is now just a frame around it.

import { useMemo, useRef, useState } from 'react';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { findProgramIssues, type GcodeRenderModel } from '../../core/gcode-view';
import { resolveViewer3dTheme } from '../viewer3d';
import { InspectorSidebar } from './InspectorSidebar';
import { InspectorSourcePane } from './InspectorSourcePane';
import { InspectorTimeline } from './InspectorTimeline';
import { lensColorFn, type LensId } from './lenses';
import { playheadAtTime, secondsAtLine } from './playhead';
import { useInspectorPlayback } from './use-inspector-playback';
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

export function InspectorView(props: {
  readonly model: GcodeRenderModel;
  readonly lines: ReadonlyArray<string>;
  readonly variant?: InspectorVariant;
}): JSX.Element {
  const full = (props.variant ?? 'full') === 'full';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [travelVisible, setTravelVisible] = useState(true);
  const [lens, setLens] = useState<LensId>('kind');
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const theme = useMemo(() => resolveViewer3dTheme(canvasRef.current), []);
  const { model } = props;
  const { handleRef, state, reason } = useViewer3dScene(canvasRef, model);
  // Planner-true seconds: the same kinematics Job Review estimates with.
  const time = useMemo(() => buildProgramTime(model, INSPECTOR_LIMITS), [model]);
  const playback = useInspectorPlayback(time.motionSeconds);
  const playhead = useMemo(
    () => playheadAtTime(model, time.segTimeEndSec, playback.routeMm),
    [model, time, playback.routeMm],
  );
  const findings = useMemo(() => findProgramIssues(model), [model]);
  // Fully-drawn playhead = show everything, so the scene never hides the tail
  // segment to floating-point rounding.
  const atEnd = playback.routeMm >= time.motionSeconds;
  const colorOf = useMemo(() => lensColorFn(model, time, lens, theme), [model, time, lens, theme]);

  useSceneSync({ handleRef, state, playhead: atEnd ? null : playhead, colorOf });

  // 3D -> source: the line whose move the playhead is executing.
  const activeLine =
    playhead.segmentIndex < 0 ? null : (model.segLine[playhead.segmentIndex] ?? null);

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
        <div style={viewportStyle}>
          <canvas ref={canvasRef} style={canvasStyle} />
          {state === 'no-webgl' ? (
            <p style={messageStyle}>
              3D view unavailable: {reason} The program parsed — readouts are live.
            </p>
          ) : null}
        </div>
        <InspectorTimeline playback={playback} totalRouteMm={time.motionSeconds} />
      </div>
      {full && sourceVisible ? (
        <InspectorSourcePane
          lines={props.lines}
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

const sourceToggleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '4px 8px 0',
};

const sourceToggleStyle: React.CSSProperties = {
  padding: '1px 8px',
  fontSize: 'var(--lf-text-xs)',
};
