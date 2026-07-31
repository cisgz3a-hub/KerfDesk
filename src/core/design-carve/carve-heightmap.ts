// carve-heightmap — composes every design layer's target surface into ONE
// heightmap (ADR-271 Amendment 1 clause 4). Deeper always wins (min-combine),
// so layer order never changes the previewed solid — exactly like material:
// once wood is gone, a shallower later cut cannot put it back.

import type { Heightmap } from '../relief';
import { entityDesignLayer, sketchLayers } from '../design/layers';
import type { SketchEntity } from '../design';
import { carveGrid, type DesignCarveInput } from './carve-input';
import { applyLayerSurface } from './layer-surface';

/**
 * The target surface of the whole sketch over the stock, Z=0 at stock top,
 * depths in [-thicknessMm, 0]. Construction entities never carve; a depth at
 * or past the stock thickness clamps to a through cut.
 */
export function designCarveHeightmap(input: DesignCarveInput): Heightmap {
  const grid = carveGrid(input.stock, input.mmPerCell);
  const depth = new Float32Array(grid.widthCells * grid.heightCells);
  const layers = sketchLayers(input.sketch);
  for (const layer of layers) {
    const entities = layerEntities(input, layer.id);
    if (entities.length === 0) continue;
    applyLayerSurface(depth, grid, layer, entities, input);
  }
  clampThrough(depth, input.stock.thicknessMm);
  return {
    widthCells: grid.widthCells,
    heightCells: grid.heightCells,
    mmPerCell: grid.mmPerCell,
    depth,
  };
}

function layerEntities(input: DesignCarveInput, layerId: string): ReadonlyArray<SketchEntity> {
  const layers = sketchLayers(input.sketch);
  return input.sketch.entities.filter(
    (entity) => entity.construction !== true && entityDesignLayer(entity, layers).id === layerId,
  );
}

function clampThrough(depth: Float32Array, thicknessMm: number): void {
  const floor = -Math.max(0, thicknessMm);
  for (let index = 0; index < depth.length; index += 1) {
    const value = depth[index] ?? 0;
    if (value < floor) depth[index] = floor;
  }
}
