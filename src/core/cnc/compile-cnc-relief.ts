import { compileReliefRestGroup } from './compile-cnc-relief-rest';
import { reliefGroup } from './cnc-relief-group';
import { reliefFinishingGroup } from './compile-cnc-relief-finishing';
import type { ReliefFinishedFlats } from '../relief/relief-flat-finish';
// compileReliefGroupsForLayer — relief objects → roughing CncGroup (H.5)
// plus the optional finishing CncGroup (H.8). Split from compile-cnc-job.ts
// by design: the main compiler dispatches, this file owns the relief branch.
//
// Per relief on the layer: rebuild the heightmap from the embedded mesh
// (coarsened to tool-diameter/8 cells for roughing, each cell holding the
// highest point of the mesh over it), apply XY scale before
// physical cutter dilation and spacing, then map every vertex through only
// the residual mirror/rotation/translation and the device origin. Cutter
// geometry therefore stays in machine millimetres under uniform and
// nonuniform object scale.

import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type { CncReliefPlanningEvidence } from '../job/job';

// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink, so the ladder
// variant cannot be added to it.
import { reliefRoughingLadder, type ReliefRoughingLadder } from '../relief/relief-roughing';
import { reliefRoughingMotion } from '../relief/relief-roughing-motion';
import { ReliefLevelArrayMaterializationError } from '../relief/relief-roughing-level-materialization';

import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import {
  applyTransform,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
  sceneObjectUsesOperation,
  type SceneObject,
  type Vec2,
} from '../scene';

import { zPassArrayMaterializationError } from './depth-passes';

import { reliefMachineSpaceGeometry, reliefMachineSpaceTransform } from './relief-machine-space';

import { materialOnRightInMap } from './relief-material-side';

const ROUGHING_CELL_TOOL_FRACTION = 8;
// Roughing group (H.5) plus — when the layer names a finishing bit — the
// H.8 finishing group that skims the true surface with it.
/** Result of compiling every relief assigned to one operation layer. */
export type ReliefGroupsCompilation =
  | {
      readonly kind: 'compiled';
      readonly groups: ReadonlyArray<CncGroup>;
      readonly evidence: ReliefLayerCompilationEvidence;
    }
  | ReliefMaterializationFailure;

type ReliefPlanEvidence = Omit<CncReliefPlanningEvidence, 'layerId'>;

type ReliefLayerCompilationEvidence = {
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
  readonly plans: ReadonlyArray<CncReliefPlanningEvidence>;
};

/** Compile every relief assigned to one CNC layer, returning source failures as data. */
export function compileReliefGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReliefGroupsCompilation {
  const reliefs = reliefObjectsForLayer(objects, layer);
  if (reliefs.length === 0) {
    return {
      kind: 'compiled',
      groups: [],
      evidence: { offsetFailed: false, passLimited: false, stepoverUsed: false, plans: [] },
    };
  }
  const tool = layerCncTool(config, settings);
  const passes: CncPass[] = [];
  const plans: CncReliefPlanningEvidence[] = [];
  // ADR-450: per relief, the flats its roughing finished for the ball to skip.
  const finishedFlats: Array<ReliefFinishedFlats | undefined> = [];
  let offsetFailed = false;
  let passLimited = false;
  let stepoverUsed = false;
  for (const relief of reliefs) {
    const roughing = appendReliefPasses(passes, relief, settings, device, tool);
    if (roughing.kind === 'relief-materialization-failed') return roughing;
    plans.push({ ...roughing.plan, layerId: layer.id });
    finishedFlats.push(roughing.finishedFlats);
    if (roughing.offsetFailed) offsetFailed = true;
    if (roughing.passLimited) passLimited = true;
    if (roughing.stepoverUsed) stepoverUsed = true;
  }
  const groups: CncGroup[] = [];
  if (passes.length > 0) {
    groups.push(
      reliefGroup(layer, settings, device, config, tool, 'relief-rough', undefined, passes),
    );
  }
  const finishing = reliefFinishingGroup(reliefs, layer, settings, device, config, finishedFlats);
  if (finishing.kind === 'relief-materialization-failed') return finishing;
  plans.push(...finishing.plans);
  if (finishing.group !== null) groups.push(finishing.group);
  const rest = compileReliefRestGroup(finishing.records, layer, settings, device, config);
  if (rest.kind === 'relief-materialization-failed') return rest;
  plans.push(...rest.plans);
  if (rest.group !== null) groups.push(rest.group);
  return {
    kind: 'compiled',
    groups,
    evidence: { offsetFailed, passLimited, stepoverUsed, plans },
  };
}

function reliefObjectsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): ReadonlyArray<ReliefObject> {
  return objects.filter(
    (o): o is ReliefObject => o.kind === 'relief' && sceneObjectUsesOperation(o, layer),
  );
}

// The one place roughing geometry is produced. Both the compiler and the
// diagnostics probe below go through it, so they can never disagree about
// whether a level's ladder was cut short.
function reliefLadderFor(
  relief: ReliefObject,
  settings: CncLayerSettings,
  tool: CncTool,
):
  | {
      readonly kind: 'compiled';
      readonly ladder: ReliefRoughingLadder;
      readonly plan: ReliefPlanEvidence;
    }
  | ReliefMaterializationFailure {
  const passArrayError = zPassArrayMaterializationError(
    relief.reliefDepthMm,
    settings.depthPerPassMm,
  );
  if (passArrayError !== null) {
    return reliefMaterializationFailure(relief.source, passArrayError);
  }
  const machineSpace = reliefMachineSpaceGeometry(relief);
  const heightmap = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: machineSpace.targetScaleX,
    targetScaleY: machineSpace.targetScaleY,
    mmPerCell: tool.diameterMm / ROUGHING_CELL_TOOL_FRACTION,
    // ADR-412 Amendment 1: a detail narrower than a cell still lifts its cells.
    sampling: 'footprint-max',
  });
  if (heightmap.kind === 'error') {
    return reliefMaterializationFailure(relief.source, heightmap.reason);
  }
  let ladder: ReliefRoughingLadder;
  try {
    ladder = reliefRoughingLadder(heightmap.heightmap, {
      tool,
      reliefDepthMm: relief.reliefDepthMm,
      depthPerPassMm: settings.depthPerPassMm,
      stepoverPercent: settings.stepoverPercent,
      ...(settings.finishAllowanceMm === undefined
        ? {}
        : { allowanceMm: settings.finishAllowanceMm }),
      ...(settings.reliefFineStepMm === undefined ? {} : { fineStepMm: settings.reliefFineStepMm }),
      ...(settings.reliefFlatFinish === 'roughing-bit' ? { finishFlats: true } : {}),
    });
  } catch (error) {
    if (error instanceof ReliefLevelArrayMaterializationError) {
      return reliefMaterializationFailure(relief.source, error.message);
    }
    throw error;
  }
  return {
    kind: 'compiled',
    ladder,
    plan: {
      source: relief.source,
      targetObjectId: relief.id,
      stage: 'roughing',
      widthCells: heightmap.heightmap.widthCells,
      heightCells: heightmap.heightmap.heightCells,
      cellSizeMm: heightmap.heightmap.mmPerCell,
      toolDiameterMm: tool.diameterMm,
      toolKind: tool.kind,
    },
  };
}

/**
 * Diagnostics: did any relief on this layer have its waterline ring ladder cut
 * short by an offset-engine failure rather than by the level running out of
 * area? Advisory input only — the caller warns, never refuses (rule 7).
 */
export function reliefOffsetLadderDiagnostics(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): { readonly offsetFailed: boolean; readonly passLimited: boolean } | null {
  const reliefs = reliefObjectsForLayer(objects, layer);
  if (reliefs.length === 0) return null;
  const tool = layerCncTool(config, settings);
  let offsetFailed = false;
  let passLimited = false;
  for (const relief of reliefs) {
    const result = reliefLadderFor(relief, settings, tool);
    // Diagnostics inform only. Compile owns the named integrity failure and
    // must not replace it with a warning-path exception.
    if (result.kind === 'relief-materialization-failed') return null;
    offsetFailed = offsetFailed || result.ladder.offsetFailed;
    passLimited = passLimited || result.ladder.passLimited;
  }
  return { offsetFailed, passLimited };
}

export function reliefOffsetLadderFailed(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): boolean {
  return reliefOffsetLadderDiagnostics(objects, layer, settings, config)?.offsetFailed ?? false;
}

function appendReliefPasses(
  passes: CncPass[],
  relief: ReliefObject,
  settings: CncLayerSettings,
  device: DeviceProfile,
  tool: CncTool,
):
  | {
      readonly kind: 'compiled';
      readonly offsetFailed: boolean;
      readonly passLimited: boolean;
      readonly stepoverUsed: boolean;
      readonly plan: ReliefPlanEvidence;
      readonly finishedFlats: ReliefFinishedFlats | undefined;
    }
  | ReliefMaterializationFailure {
  const residualTransform = reliefMachineSpaceTransform(relief.transform).residualTransform;
  const result = reliefLadderFor(relief, settings, tool);
  if (result.kind === 'relief-materialization-failed') return result;
  const place = (p: Vec2): Vec2 => toMachineCoords(applyTransform(p, residualTransform), device);
  // ADR-424: inside out, linked where the link stays in the proven region,
  // every loop in the layer's cut direction and closed at its own start, and
  // ramped in when the layer sets a ramp angle.
  const motion = reliefRoughingMotion(result.ladder.levels, {
    stockOnRight: materialOnRightInMap(residualTransform, device, settings),
    cutWidthMm: result.ladder.cutWidthMm,
    rampOutputPoint: place,
    cutterRadiusMm: tool.diameterMm / 2,
    ...(settings.rampEntryDeg === undefined ? {} : { rampAngleDeg: settings.rampEntryDeg }),
  });
  for (const pass of motion) {
    if (pass.kind === 'contour') {
      passes.push({ ...pass, polyline: pass.polyline.map(place) });
    } else if (pass.kind === 'path3d') {
      passes.push({ ...pass, points: pass.points.map((p) => ({ ...place(p), z: p.z })) });
    }
  }
  return {
    kind: 'compiled',
    offsetFailed: result.ladder.offsetFailed,
    passLimited: result.ladder.passLimited,
    stepoverUsed: true,
    plan: result.plan,
    finishedFlats: result.ladder.finishedFlats,
  };
}
