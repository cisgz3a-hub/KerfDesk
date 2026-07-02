// compileReliefGroupForLayer — relief objects → roughing CncGroup (Phase
// H.5, ADR-094). Split from compile-cnc-job.ts (284 lines) by design: the
// main compiler dispatches, this file owns the relief branch.
//
// Per relief on the layer: rebuild the heightmap from the embedded mesh
// (coarsened to tool-diameter/8 cells — roughing tolerance, keeps compile
// fast), generate waterline roughing passes in heightmap-local mm, then map
// every vertex through the object transform and the device origin — exactly
// how vector paths reach machine coordinates, so rotation/scale/mirror are
// honored.

import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncContourPass, CncGroup } from '../job';
import { meshToHeightmap, reliefRoughingPasses } from '../relief';
import {
  applyTransform,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
  type SceneObject,
} from '../scene';

const MIN_FEED_MM_PER_MIN = 1;
const MIN_ROUGHING_CELL_MM = 0.2;
const ROUGHING_CELL_TOOL_FRACTION = 8;

export function compileReliefGroupForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  const reliefs = objects.filter(
    (o): o is ReliefObject => o.kind === 'relief' && o.color === layer.color,
  );
  if (reliefs.length === 0) return null;
  const tool = layerCncTool(config, settings);
  const passes: CncContourPass[] = [];
  for (const relief of reliefs) {
    appendReliefPasses(passes, relief, settings, device, tool);
  }
  if (passes.length === 0) return null;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: 'relief-rough',
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    feedMmPerMin: cap(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: cap(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: Math.min(Math.max(0, settings.spindleRpm), config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    safeZMm: Math.max(0, config.params.safeZMm),
    passes,
  };
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
