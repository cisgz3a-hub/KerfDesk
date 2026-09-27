import { useMemo, useState } from 'react';
import type { ProgramTimeModel } from '../../core/gcode-time';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { directionArrows, resolveViewer3dTheme } from '../viewer3d';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import { useInspectorLook } from './inspector-look-preference';
import { defaultLensFor, lensColorFn, type LensId } from './lenses';
import { playheadAtTime } from './playhead';
import { buildToolSections, toolAtSegment, type ToolSections } from './tool-sections';
import { useInspectorIsolate } from './use-inspector-isolate';
import { useInspectorStage } from './use-inspector-stage';
import { useInspectorPlayback } from './use-inspector-playback';
import { useInspectorLiveProgress } from './use-inspector-live-progress';

export function useInspectorSession(
  model: GcodeRenderModel,
  analysis: GcodeInspectorAnalysis,
  source?: GcodeInspectionSource,
) {
  const [travelVisible, setTravelVisible] = useState(true);
  // Null until the operator picks one; until then the program chooses.
  const [chosenLens, setLens] = useState<LensId | null>(null);
  const machineKind = source?.machineKind;
  const programLens = useMemo(() => defaultLensFor(model, machineKind), [model, machineKind]);
  const lens = chosenLens ?? programLens;
  const [arrowsVisible, setArrowsVisible] = useState(false);
  // Seconds of done moves playback keeps bold behind the tool; 0 keeps all.
  const [trailSeconds, setTrailSeconds] = useState(0);
  const [followLive, setFollowLive] = useState(true);
  const theme = useMemo(() => resolveViewer3dTheme(), []);
  const [look, setLook] = useInspectorLook();
  const sections = useMemo(
    () => buildToolSections(model, analysis.toolMarks),
    [model, analysis.toolMarks],
  );
  const live = useInspectorLiveProgress(model, source);
  const liveMode = live.matched && followLive;
  const derived = useInspectorDerived(model, analysis, {
    lens,
    theme,
    look,
    sections,
    arrowsVisible,
    playbackEnabled: !liveMode,
  });
  const playhead = liveMode
    ? (live.playhead ?? { routeMm: 0, segmentIndex: -1, point: null, segmentFraction: 0 })
    : derived.playhead;
  const stage = useInspectorStage({
    model,
    sections,
    look,
    machineKind,
    workArea: source?.workArea,
    playheadSegment: playhead.segmentIndex,
  });
  const isolate = useInspectorIsolate({
    model,
    time: derived.time,
    lens,
    sections,
    travelVisible,
    setTravelVisible,
  });
  const activeLine = liveMode ? live.activeLine : derived.activeLine;
  const progress = liveMode
    ? (live.progress ?? 0)
    : derived.time.motionSeconds > 0
      ? derived.playback.routeMm / derived.time.motionSeconds
      : 0;
  return {
    ...derived,
    ...isolate,
    playhead,
    activeLine,
    progress,
    live,
    liveMode,
    followLive,
    setFollowLive,
    travelVisible,
    setTravelVisible,
    lens,
    setLens,
    arrowsVisible,
    setArrowsVisible,
    trailSeconds,
    setTrailSeconds,
    theme,
    look,
    setLook,
    sections,
    stage,
    activeTool: toolAtSegment(sections, playhead.segmentIndex),
  };
}

type DerivedOptions = {
  readonly lens: LensId;
  readonly theme: ReturnType<typeof resolveViewer3dTheme>;
  readonly look: ReturnType<typeof useInspectorLook>[0];
  readonly sections: ToolSections;
  readonly arrowsVisible: boolean;
  readonly playbackEnabled: boolean;
};

function useInspectorDerived(
  model: GcodeRenderModel,
  analysis: GcodeInspectorAnalysis,
  options: DerivedOptions,
): {
  readonly time: ProgramTimeModel;
  readonly playback: ReturnType<typeof useInspectorPlayback>;
  readonly playhead: ReturnType<typeof playheadAtTime>;
  readonly findings: GcodeInspectorAnalysis['findings'];
  readonly timedFor: GcodeInspectorAnalysis['timedFor'];
  readonly atEnd: boolean;
  readonly colorOf: ReturnType<typeof lensColorFn>;
  readonly arrows: ReturnType<typeof directionArrows> | null;
  /** 3D -> source: the line whose move the playhead is executing. */
  readonly activeLine: number | null;
} {
  // Timeline and findings arrive with the worker result; keep them off the UI thread.
  const { time, findings, timedFor } = analysis;
  const { lens, theme, look, sections, arrowsVisible, playbackEnabled } = options;
  const playback = useInspectorPlayback(time.motionSeconds, playbackEnabled, model);
  const playhead = useMemo(
    () => playheadAtTime(model, time.segTimeEndSec, playback.routeMm),
    [model, time, playback.routeMm],
  );
  const colorOf = useMemo(
    () => lensColorFn(model, time, lens, theme, { look, sections }),
    [model, time, lens, theme, look, sections],
  );
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
    timedFor,
    // Fully-drawn playhead = show everything, so the scene never hides the
    // tail segment to floating-point rounding.
    atEnd: playback.routeMm >= time.motionSeconds,
    colorOf,
    arrows,
    activeLine: playhead.segmentIndex < 0 ? null : (model.segLine[playhead.segmentIndex] ?? null),
  };
}
