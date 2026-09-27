// Shared read-only working surface for the canvas and the full Inspector.
import { useRef, useState } from 'react';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { InspectorSidebar } from './InspectorSidebar';
import { InspectorLensControl } from './InspectorLensControl';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import { InspectorSourcePane } from './InspectorSourcePane';
import { InspectorTimeline } from './InspectorTimeline';
import { InspectorViewerHeader } from './InspectorViewerHeader';
import { InspectorViewport } from './InspectorViewport';
import { secondsAtLine } from './playhead';
import { useFullWindow } from './use-full-window';
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
  const [readoutsVisible, setReadoutsVisible] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fullWindow = useFullWindow(bodyRef);
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
  const full = props.variant !== 'preview';
  return (
    <div className="gcode-viewer-body" ref={bodyRef}>
      <div className="gcode-viewer-column">
        <InspectorViewerHeader
          liveMode={liveMode}
          liveMatched={live.matched}
          onFollowLiveToggle={() => session.setFollowLive(!session.followLive)}
          look={session.look}
          onLookChange={session.setLook}
          layout={{
            full,
            sourceVisible,
            onSourceToggle: () => setSourceVisible((value) => !value),
            readoutsVisible,
            onReadoutsToggle: () => setReadoutsVisible((value) => !value),
            fullWindow,
          }}
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
          toolLabel={session.activeTool?.label ?? null}
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
      {props.variant !== 'preview' && readoutsVisible ? (
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
        look={s.look}
        sections={s.sections}
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
      look={s.look}
      sections={s.sections}
      playhead={s.playhead}
      time={s.time}
      timedFor={s.timedFor}
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
    stage: session.stage,
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
