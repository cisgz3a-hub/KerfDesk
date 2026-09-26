// compileReliefGroupsForLayer — relief objects → roughing CncGroup (H.5)
// plus the optional finishing CncGroup (H.8). Split from compile-cnc-job.ts
// by design: the main compiler dispatches, this file owns the relief branch.
//
// Per relief on the layer: rebuild the heightmap from the embedded mesh
// (coarsened to tool-diameter/8 cells for roughing), apply XY scale before
// physical cutter dilation and spacing, then map every vertex through only
// the residual mirror/rotation/translation and the device origin. Cutter
// geometry therefore stays in machine millimetres under uniform and
// nonuniform object scale.

import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncContourPass, CncGroup, CncPass } from '../job';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type { CncReliefPlanningEvidence } from '../job/job';
import { DEFAULT_RELIEF_SCALLOP_MM } from '../relief';
// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink, so the ladder
// variant cannot be added to it.
import { reliefRoughingLadder, type ReliefRoughingLadder } from '../relief/relief-roughing';
import { reliefScallopBallRadiusMm } from '../relief/relief-finishing';
import { reliefFinishingPlan, reliefFinishRowSpacingMm } from '../relief/relief-finishing-strategy';
import type { Heightmap } from '../relief/heightmap';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import {
  reliefMaterializationFailure,
  type ReliefMaterializationFailure,
} from '../relief/relief-materialization-failure';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
  sceneObjectUsesOperation,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import { kernelForTool } from '../sim';
import { coolantFields } from './coolant-fields';
import { cncGroupProvenance } from './cnc-group-provenance';
import { contourPassFromPolyline } from './compile-cnc-helpers';
import { zPassArrayMaterializationError } from './depth-passes';
import { enforceCutDirection, parkFields } from './motion-polish';
import { reliefMachineSpaceGeometry, reliefMachineSpaceTransform } from './relief-machine-space';
import { machineFrameHandedness } from './machine-frame-handedness';

const MIN_FEED_MM_PER_MIN = 1;
const ROUGHING_CELL_TOOL_FRACTION = 8;
// Finishing samples finer than roughing: quality lives in the skim.
const FINISHING_CELL_TOOL_FRACTION = 10;
// Tolerates rowSpacing / finestCell landing a rounding error above a whole
// number, which would otherwise add a needless extra subdivision.
const ROW_SUBDIVISION_SLACK = 1e-9;

function finishingCellSizeMm(rowSpacingMm: number, tool: CncTool): number {
  // A tapered ball nose finishes with its tip ball, so the grid resolves that
  // ball exactly as it would a ball nose of the same diameter (ADR-368).
  const ballRadiusMm = reliefScallopBallRadiusMm(tool);
  const contactDiameterMm = ballRadiusMm === null ? tool.diameterMm : 2 * ballRadiusMm;
  const finestCellMm = contactDiameterMm / FINISHING_CELL_TOOL_FRACTION;
  // ADR-421: the largest cell no coarser than the finest one that divides the
  // row spacing into whole rows, so the rows land at the requested spacing
  // instead of rounding down to the next whole row.
  const rowsPerStride = Math.max(1, Math.ceil(rowSpacingMm / finestCellMm - ROW_SUBDIVISION_SLACK));
  return rowSpacingMm / rowsPerStride;
}

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
  const passes: CncContourPass[] = [];
  const plans: CncReliefPlanningEvidence[] = [];
  let offsetFailed = false;
  let passLimited = false;
  let stepoverUsed = false;
  for (const relief of reliefs) {
    const roughing = appendReliefPasses(passes, relief, settings, device, tool);
    if (roughing.kind === 'relief-materialization-failed') return roughing;
    plans.push({ ...roughing.plan, layerId: layer.id });
    if (roughing.offsetFailed) offsetFailed = true;
    if (roughing.passLimited) passLimited = true;
    if (roughing.stepoverUsed) stepoverUsed = true;
  }
  const groups: CncGroup[] = [];
  if (passes.length > 0) {
    groups.push(reliefGroup(layer, settings, device, config, tool, 'relief-rough', passes));
  }
  const finishing = reliefFinishingGroup(reliefs, layer, settings, device, config);
  if (finishing.kind === 'relief-materialization-failed') return finishing;
  plans.push(...finishing.plans);
  if (finishing.group !== null) groups.push(finishing.group);
  return {
    kind: 'compiled',
    groups,
    evidence: { offsetFailed, passLimited, stepoverUsed, plans },
  };
}

function reliefGroup(
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
  tool: CncTool,
  cutType: 'relief-rough' | 'relief-finish',
  passes: ReadonlyArray<CncPass>,
  layerPrimaryTool: CncTool = tool,
): CncGroup {
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    ...cncGroupProvenance(settings, tool, {
      includeRequestedDepth: false,
      includeDepthPerPass: cutType !== 'relief-finish',
      includeVResolution: false,
      layerPrimaryTool,
    }),
    feedMmPerMin: cap(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: cap(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: Math.min(Math.max(0, settings.spindleRpm), config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    // Relief roughing/finishing follows the surface continuously; the emitter's
    // per-pass retract mode does not apply (ADR-253).
    retractBetweenPasses: false,
    passes,
  };
}

// The H.8 finishing skim: its own heightmap at the finishing bit's (finer)
// resolution, serpentine max-plus tip-surface rows, mapped through the
// machine-space residual transform + device origin exactly like roughing.
function reliefFinishingGroup(
  reliefs: ReadonlyArray<ReliefObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
):
  | {
      readonly kind: 'compiled';
      readonly group: CncGroup | null;
      readonly plans: ReadonlyArray<CncReliefPlanningEvidence>;
    }
  | ReliefMaterializationFailure {
  if (settings.reliefFinishToolId === undefined) {
    return { kind: 'compiled', group: null, plans: [] };
  }
  const finishTool = config.tools.find((tool) => tool.id === settings.reliefFinishToolId);
  if (finishTool === undefined) return { kind: 'compiled', group: null, plans: [] };
  const scallopMm = settings.reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM;
  const strategy = settings.reliefFinishStrategy ?? 'raster';
  const rowSpacingMm = reliefFinishRowSpacingMm(finishTool, scallopMm, strategy);
  const passes: CncPass[] = [];
  const plans: CncReliefPlanningEvidence[] = [];
  for (const relief of reliefs) {
    const machineSpace = reliefMachineSpaceGeometry(relief);
    const heightmap = reliefObjectToHeightmap(relief, {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      targetScaleX: machineSpace.targetScaleX,
      targetScaleY: machineSpace.targetScaleY,
      mmPerCell: finishingCellSizeMm(rowSpacingMm, finishTool),
    });
    if (heightmap.kind === 'error') {
      return reliefMaterializationFailure(relief.source, heightmap.reason);
    }
    plans.push({
      ...finishingGridEvidence(layer, relief, heightmap.heightmap, finishTool),
      rowSpacingMm,
      scallopMm,
    });
    const residual = machineSpace.residualTransform;
    for (const pass of reliefFinishingPlan(heightmap.heightmap, {
      tool: finishTool,
      kernel: kernelForTool(finishTool, heightmap.heightmap.mmPerCell),
      scallopMm,
      strategy,
      rasterAxis: settings.reliefRasterAxis ?? 'x',
      wallOnRight: waterlineWallOnRight(residual, device, settings),
    })) {
      if (pass.kind !== 'path3d') continue;
      const points = pass.points.map((p) => ({
        ...toMachineCoords(applyTransform(p, residual), device),
        z: p.z,
      }));
      passes.push({ ...pass, points });
    }
  }
  if (passes.length === 0) return { kind: 'compiled', group: null, plans };
  return {
    kind: 'compiled',
    plans,
    group: reliefGroup(
      layer,
      settings,
      device,
      config,
      finishTool,
      'relief-finish',
      passes,
      layerCncTool(config, settings),
    ),
  };
}

// ADR-423: which side of travel the wall should be on, in heightmap numbers,
// for the layer's cut direction. Climb keeps the material right of travel on
// the physical bed (motion-polish.ts); the placement and the machine frame may
// each mirror that.
function waterlineWallOnRight(
  residualTransform: Transform,
  device: DeviceProfile,
  settings: CncLayerSettings,
): boolean {
  const place = (x: number, y: number): Vec2 =>
    toMachineCoords(applyTransform({ x, y }, residualTransform), device);
  const origin = place(0, 0);
  const alongX = place(1, 0);
  const alongY = place(0, 1);
  const determinant =
    (alongX.x - origin.x) * (alongY.y - origin.y) - (alongX.y - origin.y) * (alongY.x - origin.x);
  const keepsSides = determinant * machineFrameHandedness(device.origin) > 0;
  const climb =
    (settings.cutDirection ?? DEFAULT_CNC_LAYER_SETTINGS.cutDirection ?? 'climb') === 'climb';
  return keepsSides === climb;
}

function finishingGridEvidence(
  layer: Layer,
  relief: ReliefObject,
  heightmap: Heightmap,
  tool: CncTool,
): CncReliefPlanningEvidence {
  return {
    layerId: layer.id,
    source: relief.source,
    stage: 'finishing',
    widthCells: heightmap.widthCells,
    heightCells: heightmap.heightCells,
    cellSizeMm: heightmap.mmPerCell,
    toolDiameterMm: tool.diameterMm,
    toolKind: tool.kind,
    ...finishingTipEvidence(tool),
  };
}

// Only a tapered ball nose's cusp depends on a tip smaller than its stored
// diameter; Job Review needs that tip to explain a clamped scallop request.
function finishingTipEvidence(tool: CncTool): { readonly toolTipDiameterMm?: number } {
  if (tool.kind !== 'tapered-ball-nose') return {};
  const ballRadiusMm = reliefScallopBallRadiusMm(tool);
  return ballRadiusMm === null ? {} : { toolTipDiameterMm: 2 * ballRadiusMm };
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
  });
  if (heightmap.kind === 'error') {
    return reliefMaterializationFailure(relief.source, heightmap.reason);
  }
  const ladder = reliefRoughingLadder(heightmap.heightmap, {
    tool,
    reliefDepthMm: relief.reliefDepthMm,
    depthPerPassMm: settings.depthPerPassMm,
    stepoverPercent: settings.stepoverPercent,
    ...(settings.finishAllowanceMm === undefined
      ? {}
      : { allowanceMm: settings.finishAllowanceMm }),
  });
  return {
    kind: 'compiled',
    ladder,
    plan: {
      source: relief.source,
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
  passes: CncContourPass[],
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
    }
  | ReliefMaterializationFailure {
  const residualTransform = reliefMachineSpaceTransform(relief.transform).residualTransform;
  const result = reliefLadderFor(relief, settings, tool);
  if (result.kind === 'relief-materialization-failed') return result;
  for (const pass of result.ladder.passes) {
    if (pass.kind !== 'contour') continue;
    const mapped = pass.polyline.map((p) =>
      toMachineCoords(applyTransform(p, residualTransform), device),
    );
    const directed = enforceCutDirection(
      [{ points: mapped, closed: pass.closed }],
      settings.cutDirection ?? DEFAULT_CNC_LAYER_SETTINGS.cutDirection ?? 'climb',
      'pocket',
      machineFrameHandedness(device.origin),
    )[0];
    if (directed === undefined) continue;
    // The ladder closes each ring on its first point, and direction
    // enforcement then moves the start to the middle of the longest segment.
    // That leaves the old closing point as a repeated vertex mid-ring and ends
    // the ring at the corner before its new start, half that segment short
    // (ADR-289 Amendment 1). Drop the repeat and close the ring at its new
    // start, as pocket rings are closed.
    const points = withoutRepeatedPoints(directed.points);
    passes.push(contourPassFromPolyline({ ...directed, points }, pass.zMm));
  }
  return {
    kind: 'compiled',
    offsetFailed: result.ladder.offsetFailed,
    passLimited: result.ladder.passLimited,
    stepoverUsed: true,
    plan: result.plan,
  };
}

function withoutRepeatedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || previous.x !== point.x || previous.y !== point.y;
  });
}

function cap(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}
