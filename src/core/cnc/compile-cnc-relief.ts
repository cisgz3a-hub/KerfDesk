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
import { DEFAULT_RELIEF_SCALLOP_MM, reliefFinishingPasses, scallopRowSpacingMm } from '../relief';
// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink, so the ladder
// variant cannot be added to it.
import { reliefRoughingLadder, type ReliefRoughingLadder } from '../relief/relief-roughing';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import { ReliefMaterializationError } from '../relief/relief-materialization-error';
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
} from '../scene';
import { kernelForTool } from '../sim';
import { coolantFields } from './coolant-fields';
import { cncGroupProvenance } from './cnc-group-provenance';
import { parkFields } from './motion-polish';
import { reliefMachineSpaceTransform } from './relief-machine-space';

const MIN_FEED_MM_PER_MIN = 1;
const MIN_ROUGHING_CELL_MM = 0.2;
const ROUGHING_CELL_TOOL_FRACTION = 8;
// Finishing samples finer than roughing: quality lives in the skim.
const MIN_FINISHING_CELL_MM = 0.1;
const FINISHING_CELL_TOOL_FRACTION = 10;

// Roughing group (H.5) plus — when the layer names a finishing bit — the
// H.8 finishing group that skims the true surface with it.
export function compileReliefGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncGroup> {
  const reliefs = reliefObjectsForLayer(objects, layer);
  if (reliefs.length === 0) return [];
  const tool = layerCncTool(config, settings);
  const passes: CncContourPass[] = [];
  for (const relief of reliefs) {
    appendReliefPasses(passes, relief, settings, device, tool);
  }
  if (passes.length === 0) return [];
  const roughing = reliefGroup(layer, settings, device, config, tool, 'relief-rough', passes);
  const finishing = reliefFinishingGroup(reliefs, layer, settings, device, config);
  return finishing === null ? [roughing] : [roughing, finishing];
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
): CncGroup | null {
  if (settings.reliefFinishToolId === undefined) return null;
  const finishTool = config.tools.find((tool) => tool.id === settings.reliefFinishToolId);
  if (finishTool === undefined) return null;
  const scallopMm = settings.reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM;
  const rowSpacingMm = scallopRowSpacingMm(finishTool, scallopMm);
  const passes: CncPass[] = [];
  for (const relief of reliefs) {
    const machineSpace = reliefMachineSpaceTransform(relief.transform);
    const heightmap = reliefObjectToHeightmap(relief, {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      targetScaleX: machineSpace.targetScaleX,
      targetScaleY: machineSpace.targetScaleY,
      mmPerCell: Math.min(
        rowSpacingMm,
        Math.max(MIN_FINISHING_CELL_MM, finishTool.diameterMm / FINISHING_CELL_TOOL_FRACTION),
      ),
    });
    if (heightmap.kind === 'error') {
      throw new ReliefMaterializationError(relief.source, heightmap.reason);
    }
    const kernel = kernelForTool(finishTool, heightmap.heightmap.mmPerCell);
    for (const pass of reliefFinishingPasses(heightmap.heightmap, {
      tool: finishTool,
      kernel,
      scallopMm,
    })) {
      if (pass.kind !== 'path3d') continue;
      passes.push({
        ...pass,
        points: pass.points.map((p) => ({
          ...toMachineCoords(applyTransform(p, machineSpace.residualTransform), device),
          z: p.z,
        })),
      });
    }
  }
  if (passes.length === 0) return null;
  return reliefGroup(
    layer,
    settings,
    device,
    config,
    finishTool,
    'relief-finish',
    passes,
    layerCncTool(config, settings),
  );
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
): ReliefRoughingLadder {
  const machineSpace = reliefMachineSpaceTransform(relief.transform);
  const heightmap = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: machineSpace.targetScaleX,
    targetScaleY: machineSpace.targetScaleY,
    mmPerCell: Math.max(MIN_ROUGHING_CELL_MM, tool.diameterMm / ROUGHING_CELL_TOOL_FRACTION),
  });
  if (heightmap.kind === 'error') {
    throw new ReliefMaterializationError(relief.source, heightmap.reason);
  }
  return reliefRoughingLadder(heightmap.heightmap, {
    tool,
    reliefDepthMm: relief.reliefDepthMm,
    depthPerPassMm: settings.depthPerPassMm,
    stepoverPercent: settings.stepoverPercent,
  });
}

/**
 * Diagnostics: did any relief on this layer have its waterline ring ladder cut
 * short by an offset-engine failure rather than by the level running out of
 * area? Advisory input only — the caller warns, never refuses (rule 7).
 */
export function reliefOffsetLadderFailed(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): boolean {
  const reliefs = reliefObjectsForLayer(objects, layer);
  if (reliefs.length === 0) return false;
  const tool = layerCncTool(config, settings);
  try {
    return reliefs.some((relief) => reliefLadderFor(relief, settings, tool).offsetFailed);
  } catch (error) {
    // Diagnostics inform only. Compile owns the named integrity failure and
    // must not be replaced by a warning-path exception.
    if (error instanceof ReliefMaterializationError) return false;
    throw error;
  }
}

function appendReliefPasses(
  passes: CncContourPass[],
  relief: ReliefObject,
  settings: CncLayerSettings,
  device: DeviceProfile,
  tool: CncTool,
): void {
  const residualTransform = reliefMachineSpaceTransform(relief.transform).residualTransform;
  for (const pass of reliefLadderFor(relief, settings, tool).passes) {
    if (pass.kind !== 'contour') continue;
    passes.push({
      ...pass,
      polyline: pass.polyline.map((p) =>
        toMachineCoords(applyTransform(p, residualTransform), device),
      ),
    });
  }
}

function cap(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}
