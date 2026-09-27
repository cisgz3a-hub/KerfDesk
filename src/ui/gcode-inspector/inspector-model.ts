// What the Inspector keeps of a parsed program (ADR-485). The worker plans the
// program's timing from the full render model and the planner's per-move
// arrays, then hands the page only what the Inspector reads. The rest stays in
// the worker and is freed: about 44 bytes a move, 44 MB on a million-move job.

import type { ProgramTimeModel } from '../../core/gcode-time';
import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { MoveDetail } from '../viewer3d/move-detail';

/**
 * The render model without the route and length arrays only timing used, and
 * with the lighter drawings of a big program, worked out in the worker.
 */
export type InspectorRenderModel = Omit<GcodeRenderModel, 'segRouteEndMm' | 'segLengthMm'> & {
  readonly detail?: MoveDetail | null;
};

/** The program time without the planner's per-move working arrays. */
export type InspectorProgramTime = Omit<
  ProgramTimeModel,
  | 'segSeconds'
  | 'segTimeScale'
  | 'segDistanceMm'
  | 'segTargetVelocityMmPerSec'
  | 'segEntryVelocityMmPerSec'
  | 'segExitVelocityMmPerSec'
> & {
  /** Motion seconds per move kind, indexed by SEG_KIND, for the time split. */
  readonly kindSeconds: Float64Array;
};

export function inspectorRenderModel(
  model: GcodeRenderModel,
  detail: MoveDetail | null = null,
): InspectorRenderModel {
  const { segRouteEndMm: _routeEnd, segLengthMm: _length, ...kept } = model;
  return detail === null ? kept : { ...kept, detail };
}

export function inspectorProgramTime(
  model: Pick<GcodeRenderModel, 'segmentCount' | 'segKind'>,
  time: ProgramTimeModel,
): InspectorProgramTime {
  const {
    segSeconds,
    segTimeScale: _timeScale,
    segDistanceMm: _distance,
    segTargetVelocityMmPerSec: _target,
    segEntryVelocityMmPerSec: _entry,
    segExitVelocityMmPerSec: _exit,
    ...kept
  } = time;
  const kindSeconds = new Float64Array(KIND_COUNT);
  for (let index = 0; index < model.segmentCount; index += 1) {
    const kind = model.segKind[index] ?? SEG_KIND.travel;
    kindSeconds[kind] = (kindSeconds[kind] ?? 0) + (segSeconds[index] ?? 0);
  }
  return { ...kept, kindSeconds };
}

const KIND_COUNT = Math.max(...Object.values(SEG_KIND)) + 1;
