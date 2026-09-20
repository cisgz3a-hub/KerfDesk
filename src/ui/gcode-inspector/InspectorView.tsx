// Shared read-only working surface for the canvas and the full Inspector.
import { TutorialButton } from '../tutorials/TutorialButton';
import { useRef, useState } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { InspectorSidebar } from './InspectorSidebar';
import { InspectorLensControl } from './InspectorLensControl';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import { InspectorSourcePane } from './InspectorSourcePane';
import { InspectorTimeline } from './InspectorTimeline';
import { InspectorViewport } from './InspectorViewport';
import { secondsAtLine } from './playhead';
import { useInspectorCamera } from './use-inspector-camera';
import { useInspectorSession } from './use-inspector-session';
import { useSceneSync } from './use-scene-sync';
import { useViewer3dScene } from './use-viewer3d-scene';

export type InspectorVariant = 'full' | 'preview';
type InspectorViewProps =
  | {
      readonly model: GcodeRenderModel;
      readonly analysis: GcodeInspectorAnalysis;
      readonly source: GcodeInspectionSource;
      readonly sourceIndex: GcodeSourceLineIndex;
      readonly variant?: 'full';
    }
  | {
      readonly model: GcodeRenderModel;
      readonly analysis: GcodeInspectorAnalysis;
      readonly source?: GcodeInspectionSource;
      readonly variant: 'preview';
    };
type Session = ReturnType<typeof useInspectorSession>;

export function InspectorView(props: InspectorViewProps): JSX.Element {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const session = useInspectorSession(props.model, props.analysis, props.source);
  const { canvasRef, handleRef, state, reason, camera } = useInspectorScene(props.model, session);
  const { playhead, liveMode, live } = session;
  const locateLine = (line: number): void => {
    setSelectedLine(line);
    if (liveMode) return;
    const target = secondsAtLine(props.model, session.time.segTimeEndSec, line);
    if (target !== null) session.playback.setRouteMm(target);
  };
  const travelChange = session.setTravelVisible;
  return (
    <div className="gcode-viewer-body">
      <div className="gcode-viewer-column">
        <ViewerHeader
          session={session}
          full={props.variant !== 'preview'}
          sourceVisible={sourceVisible}
          onSourceToggle={() => setSourceVisible((value) => !value)}
        />
        <InspectorViewport
          canvasRef={canvasRef}
          handleRef={handleRef}
          state={state}
          reason={reason}
          cameraMode={camera.cameraMode}
          onCameraModeChange={camera.setCameraMode}
          live={liveMode ? live : null}
          playhead={playhead}
          activeLine={session.activeLine}
          playing={session.playback.playing}
          travelVisible={session.travelVisible}
          onTravelChange={travelChange}
        >
          {props.variant === 'preview' ? (
            <PreviewLens model={props.model} session={session} />
          ) : null}
        </InspectorViewport>
        <SessionTimeline session={session} />
      </div>
      {props.variant !== 'preview' && sourceVisible ? (
        <InspectorSourcePane
          source={props.source}
          sourceIndex={props.sourceIndex}
          categories={props.model.lineCategories}
          activeLine={session.activeLine}
          selectedLine={selectedLine}
          onSelectLine={locateLine}
        />
      ) : null}
      {props.variant !== 'preview' ? (
        <Readouts
          model={props.model}
          session={session}
          onTravelChange={travelChange}
          onLocateLine={locateLine}
        />
      ) : null}
    </div>
  );
}

function PreviewLens(props: {
  readonly model: GcodeRenderModel;
  readonly session: Session;
}): JSX.Element {
  const s = props.session;
  return (
    <div style={previewLensStyle}>
      <InspectorLensControl
        model={props.model}
        time={s.time}
        theme={s.theme}
        lens={s.lens}
        onLensChange={s.setLens}
        variant="overlay"
      />
    </div>
  );
}

function SessionTimeline({ session }: { readonly session: Session }): JSX.Element {
  const { live, liveMode } = session;
  return (
    <InspectorTimeline
      playback={session.playback}
      totalRouteMm={session.time.motionSeconds}
      live={
        liveMode
          ? {
              progress: live.progress,
              active: live.active,
              label: live.reason ?? `${live.lifecycle ?? 'Waiting'} / confirmed route`,
            }
          : null
      }
    />
  );
}

function ViewerHeader(props: {
  readonly session: Session;
  readonly full: boolean;
  readonly sourceVisible: boolean;
  readonly onSourceToggle: () => void;
}): JSX.Element {
  const { session } = props;
  return (
    <div className="gcode-viewer-header">
      <div className="gcode-viewer-heading">
        <span className="gcode-viewer-eyebrow">G-CODE / 3D</span>
        <span className="gcode-viewer-subtitle">
          {session.liveMode ? 'Watching the started program' : 'Explore the toolpath'}
        </span>
      </div>
      <div className="gcode-viewer-header-actions">
        <TutorialButton tutorialId="gcode" />
        {session.live.matched ? (
          <button
            type="button"
            className="lf-btn"
            aria-pressed={session.liveMode}
            title="Switch between reported machine progress and local preview playback"
            onClick={() => session.setFollowLive(!session.followLive)}
          >
            {session.liveMode ? 'Preview playback' : 'Watch live run'}
          </button>
        ) : null}
        {props.full ? (
          <button
            type="button"
            className="lf-btn"
            aria-pressed={props.sourceVisible}
            title="Show or hide the G-code source beside the 3D view"
            onClick={props.onSourceToggle}
          >
            {props.sourceVisible ? 'Hide source' : 'Show source'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Readouts(props: {
  readonly model: GcodeRenderModel;
  readonly session: Session;
  readonly onTravelChange: (visible: boolean) => void;
  readonly onLocateLine: (line: number) => void;
}): JSX.Element {
  const s = props.session;
  return (
    <InspectorSidebar
      model={props.model}
      theme={s.theme}
      playhead={s.playhead}
      time={s.time}
      findings={s.findings}
      lens={s.lens}
      onLensChange={s.setLens}
      arrowsVisible={s.arrowsVisible}
      onArrowsVisibleChange={s.setArrowsVisible}
      travelVisible={s.travelVisible}
      onTravelVisibleChange={props.onTravelChange}
      onLocateLine={props.onLocateLine}
    />
  );
}

function useInspectorScene(model: GcodeRenderModel, session: Session) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { handleRef, state, reason } = useViewer3dScene(canvasRef, model);
  const { playhead, liveMode, live } = session;
  useSceneSync({
    handleRef,
    state,
    model: model,
    playhead: liveMode ? playhead : session.atEnd ? null : playhead,
    colorOf: session.colorOf,
    live: liveMode ? live.point : null,
    arrows: session.arrows,
    hidePlaybackMarker: liveMode,
    travelVisible: session.travelVisible,
  });
  const camera = useInspectorCamera(
    handleRef,
    state,
    {
      point: liveMode ? live.point : session.atEnd ? null : playhead.point,
      progress: session.progress,
    },
    model,
  );
  return { canvasRef, handleRef, state, reason, camera };
}

const previewLensStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 44,
  width: 250,
  maxWidth: '100%',
};
