// Shared read-only working surface for the canvas and the full Inspector.
import { useRef, useState } from 'react';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dPick } from '../viewer3d/scene-pick';
import type { InspectorRenderModel } from './inspector-model';
import { InspectorSidebar } from './InspectorSidebar';
import { InspectorLensControl } from './InspectorLensControl';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import { InspectorSourcePane } from './InspectorSourcePane';
import { InspectorTimeline } from './InspectorTimeline';
import { InspectorViewerHeader } from './InspectorViewerHeader';
import { InspectorPreviewStock } from './InspectorPreviewStock';
import { InspectorViewport } from './InspectorViewport';
import { secondsAtPick } from './pick-readout';
import { secondsAtLine, stepMoveSeconds, trailStartSegment } from './playhead';
import { useFullWindow } from './use-full-window';
import { useInspectorCamera } from './use-inspector-camera';
import { useInspectorSession } from './use-inspector-session';
import { useSceneSync } from './use-scene-sync';
import { useViewer3dScene } from './use-viewer3d-scene';
import type { CarvedStock } from './use-carved-stock';
import { useInspectorMaterials } from './use-inspector-materials';
import type { LaserBurn } from './use-laser-burn';

export type InspectorVariant = 'full' | 'preview';
type InspectorViewProps =
  | {
      readonly model: InspectorRenderModel;
      readonly analysis: GcodeInspectorAnalysis;
      readonly source: GcodeInspectionSource;
      readonly sourceIndex: GcodeSourceLineIndex;
      readonly variant?: 'full';
    }
  | {
      readonly model: InspectorRenderModel;
      readonly analysis: GcodeInspectorAnalysis;
      readonly source?: GcodeInspectionSource;
      readonly variant: 'preview';
    };
type Session = ReturnType<typeof useInspectorSession>;

export function InspectorView(props: InspectorViewProps): JSX.Element {
  const [sourceVisible, setSourceVisible] = useState(true);
  const [readoutsVisible, setReadoutsVisible] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fullWindow = useFullWindow(bodyRef);
  const session = useInspectorSession(props.model, props.analysis, props.source);
  const scene = useInspectorScene(props.model, session, props.source, props.variant === 'preview');
  const { canvasRef, handleRef, state, reason, camera } = scene;
  const { playhead, liveMode, live } = session;
  const { selectedLine, locateLine, locateMove } = useLocators(props.model, session);
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
          topView={{ model: props.model, colorOf: session.colorOf }}
          cameraMode={camera.cameraMode}
          onCameraModeChange={camera.setCameraMode}
          live={liveMode ? live : null}
          playhead={playhead}
          activeLine={session.activeLine}
          toolLabel={session.activeTool?.label ?? null}
          playing={session.playback.playing}
          travelVisible={session.travelVisible}
          onTravelChange={travelChange}
          movePick={{
            model: props.model,
            segTimeEndSec: session.time.segTimeEndSec,
            onLocate: locateMove,
          }}
          transport={liveMode ? undefined : keyTransport(props.model, session)}
        >
          {props.variant === 'preview' ? (
            <PreviewOverlays {...{ session, scene }} model={props.model} />
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
          materials={scene}
        />
      ) : null}
    </div>
  );
}

// Jumps to a place in the program: its source line selected and, outside
// live mode, the playhead moved there.
function useLocators(model: InspectorRenderModel, session: Session) {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const segTimeEndSec = session.time.segTimeEndSec;
  const jumpTo = (line: number, seconds: number | null): void => {
    setSelectedLine(line);
    if (!session.liveMode && seconds !== null) session.playback.setRouteMm(seconds);
  };
  return {
    selectedLine,
    locateLine: (line: number): void => jumpTo(line, secondsAtLine(model, segTimeEndSec, line)),
    // A clicked move: its line, and the playhead at the clicked point on it.
    locateMove: (pick: Viewer3dPick): void => {
      const line = model.segLine[pick.segmentIndex];
      if (line !== undefined) jumpTo(line, secondsAtPick(segTimeEndSec, pick));
    },
  };
}

// What the 3D view's keys play and step (ADR-470).
function keyTransport(model: InspectorRenderModel, session: Session) {
  const { playback, time } = session;
  return {
    togglePlay: playback.togglePlay,
    stepMove: (direction: 1 | -1): void =>
      playback.setRouteMm(
        stepMoveSeconds(time.segTimeEndSec, model.segmentCount, playback.routeMm, direction),
      ),
    toStart: (): void => playback.setRouteMm(0),
    toEnd: (): void => playback.setRouteMm(time.motionSeconds),
  };
}

function PreviewOverlays(props: {
  readonly model: InspectorRenderModel;
  readonly session: Session;
  readonly scene: { readonly stock: CarvedStock };
}): JSX.Element {
  return (
    <>
      <PreviewLens model={props.model} session={props.session} />
      <InspectorPreviewStock stock={props.scene.stock} />
    </>
  );
}

function PreviewLens(props: {
  readonly model: InspectorRenderModel;
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
        hiddenEntries={s.legendHidden}
        onToggleEntry={s.toggleEntry}
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
      trail={{ seconds: session.trailSeconds, onChange: session.setTrailSeconds }}
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
  readonly model: InspectorRenderModel;
  readonly session: Session;
  readonly onTravelChange: (visible: boolean) => void;
  readonly onLocateLine: (line: number) => void;
  /** The carved stock's and the burn preview's switches (ADR-487). */
  readonly materials: { readonly stock: CarvedStock; readonly burn: LaserBurn };
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
      hiddenEntries={s.legendHidden}
      onToggleEntry={s.toggleEntry}
      isolate={s.isolate}
      onIsolateChange={s.setIsolate}
      stock={props.materials.stock}
      burn={props.materials.burn}
    />
  );
}

// The stock carves as far as the playhead: the whole program with playback
// at its end, nothing while a live job has not started.
function stockTarget(model: InspectorRenderModel, session: Session) {
  const { playhead } = session;
  if (!session.liveMode && session.atEnd) return { index: model.segmentCount, fraction: 0 };
  if (playhead.segmentIndex < 0) return { index: 0, fraction: 0 };
  return { index: playhead.segmentIndex, fraction: playhead.segmentFraction };
}

function useInspectorScene(
  model: InspectorRenderModel,
  session: Session,
  source: GcodeInspectionSource | undefined,
  preview: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { handleRef, state, reason } = useViewer3dScene(canvasRef, model);
  const { stock, burn } = useInspectorMaterials({
    handleRef,
    state,
    model,
    sections: session.sections,
    source,
    target: stockTarget(model, session),
    // ADR-580: the canvas view shows a relief job as the carving it makes.
    stockInitiallyShown: preview && (source?.design?.reliefs.length ?? 0) > 0,
  });
  const { playhead, liveMode, live } = session;
  const trailing = !liveMode && session.trailSeconds > 0;
  const trailed = trailing
    ? {
        ...playhead,
        trailFrom: trailStartSegment(
          session.time.segTimeEndSec,
          model.segmentCount,
          playhead.routeMm,
          session.trailSeconds,
        ),
      }
    : playhead;
  useSceneSync({
    handleRef,
    state,
    model: model,
    playhead: liveMode ? playhead : session.atEnd ? null : trailed,
    colorOf: session.colorOf,
    live: liveMode ? live.point : null,
    arrows: session.arrows,
    hidePlaybackMarker: liveMode,
    travelVisible: session.travelVisible,
    stage: session.stage,
    moveFilter: session.moveFilter,
    clipPlanes: session.clipPlanes,
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
  return { canvasRef, handleRef, state, reason, camera, stock, burn };
}

const previewLensStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 44,
  width: 250,
  maxWidth: '100%',
};
