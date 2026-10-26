// Job-wide kept walls for CNC profile leads (ADR-250 Amendment 3). A lead is
// baked while its own operation compiles, so the walls of every profile
// operation are collected first, from the same selected contours each
// operation's kerf offset will use. The collected source geometry is handed
// back so those operations do not collect their contours twice.

import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Layer,
  type Scene,
} from '../scene';
import type { CncOperationSourceGeometry } from './cnc-compilation-artifact';
import { collectLayerContours, layerPolylinesFromContours } from './collect-cnc-contours';
import { isProfileCutType } from './compile-cnc-helpers';
import { lineArtContoursForLayer } from './compile-cnc-layer-passes';
import {
  profileLeadCutWidthMm,
  profileLeadKeptWalls,
  type ProfileLeadKeptWall,
} from './profile-lead-kept-walls';

export type ProfileLeadJobWalls = {
  readonly walls: ReadonlyArray<ProfileLeadKeptWall>;
  /** Source geometry collected for the walls, keyed by operation index. */
  readonly geometry: ReadonlyMap<number, CncOperationSourceGeometry>;
};

export function profileLeadJobWalls(
  runs: ReadonlyArray<{ readonly layer: Layer }>,
  sourceObjects: Scene['objects'],
  device: DeviceProfile,
  config: CncMachineConfig,
  known?: ReadonlyMap<number, CncOperationSourceGeometry>,
): ProfileLeadJobWalls {
  const walls: ProfileLeadKeptWall[] = [];
  const geometry = new Map<number, CncOperationSourceGeometry>();
  for (const [operationIndex, { layer }] of runs.entries()) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (!isProfileCutType(settings.cutType) || settings.reliefProjection !== undefined) continue;
    const source = known?.get(operationIndex) ?? collectedGeometry(sourceObjects, layer, device);
    geometry.set(operationIndex, source);
    const tool = layerCncTool(config, settings);
    const contours = lineArtContoursForLayer(
      source.polylines,
      settings,
      tool.diameterMm,
      source.contours,
    );
    walls.push(
      ...profileLeadKeptWalls(contours, settings.cutType, profileLeadCutWidthMm(tool, settings)),
    );
  }
  return { walls, geometry };
}

function collectedGeometry(
  sourceObjects: Scene['objects'],
  layer: Layer,
  device: DeviceProfile,
): CncOperationSourceGeometry {
  const contours = collectLayerContours(sourceObjects, layer, device);
  return { contours, polylines: layerPolylinesFromContours(layer, contours) };
}
