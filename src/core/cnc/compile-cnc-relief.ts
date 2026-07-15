// compileReliefGroupsForLayer — relief objects → roughing CncGroup (H.5)
// plus the optional finishing CncGroup (H.8). Split from compile-cnc-job.ts
// by design: the main compiler dispatches, this file owns the relief branch.
//
// Per relief on the layer: rebuild the heightmap from the embedded mesh
// (coarsened to tool-diameter/8 cells — roughing tolerance, keeps compile
// fast), generate waterline roughing passes in heightmap-local mm, then map
// every vertex through the object transform and the device origin — exactly
// how vector paths reach machine coordinates, so rotation/scale/mirror are
// honored.

import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncContourPass, CncGroup, CncPass } from '../job';
import {
  DEFAULT_RELIEF_SCALLOP_MM,
  meshToHeightmap,
  reliefFinishingPasses,
  reliefRoughingPasses,
} from '../relief';
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
import { parkFields } from './motion-polish';

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
  const reliefs = objects.filter(
    (o): o is ReliefObject => o.kind === 'relief' && sceneObjectUsesOperation(o, layer),
  );
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
): CncGroup {
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    feedMmPerMin: cap(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: cap(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: Math.min(Math.max(0, settings.spindleRpm), config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    passes,
  };
}

// The H.8 finishing skim: its own heightmap at the finishing bit's (finer)
// resolution, serpentine max-plus tip-surface rows, mapped through the
// object transform + device origin exactly like roughing.
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
  const passes: CncPass[] = [];
  for (const relief of reliefs) {
    const heightmap = meshToHeightmap(
      { positions: Float32Array.from(relief.meshPositions) },
      {
        targetWidthMm: relief.targetWidthMm,
        reliefDepthMm: relief.reliefDepthMm,
        emptyCells: relief.emptyCells,
        mmPerCell: Math.max(
          MIN_FINISHING_CELL_MM,
          finishTool.diameterMm / FINISHING_CELL_TOOL_FRACTION,
        ),
      },
    );
    if (heightmap.kind === 'error') continue;
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
          ...toMachineCoords(applyTransform(p, relief.transform), device),
          z: p.z,
        })),
      });
    }
  }
  if (passes.length === 0) return null;
  return reliefGroup(layer, settings, device, config, finishTool, 'relief-finish', passes);
}

function appendReliefPasses(
  passes: CncContourPass[],
  relief: ReliefObject,
  settings: CncLayerSettings,
  device: DeviceProfile,
  tool: CncTool,
): void {
  const heightmap = meshToHeightmap(
    { positions: Float32Array.from(relief.meshPositions) },
    {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      emptyCells: relief.emptyCells,
      mmPerCell: Math.max(MIN_ROUGHING_CELL_MM, tool.diameterMm / ROUGHING_CELL_TOOL_FRACTION),
    },
  );
  if (heightmap.kind === 'error') return;
  const local = reliefRoughingPasses(heightmap.heightmap, {
    tool,
    reliefDepthMm: relief.reliefDepthMm,
    depthPerPassMm: settings.depthPerPassMm,
    stepoverPercent: settings.stepoverPercent,
  });
  for (const pass of local) {
    if (pass.kind !== 'contour') continue;
    passes.push({
      ...pass,
      polyline: pass.polyline.map((p) =>
        toMachineCoords(applyTransform(p, relief.transform), device),
      ),
    });
  }
}

function cap(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}
