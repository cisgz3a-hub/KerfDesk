import type { ReliefObject } from '../scene';
import { cachedFloat32Array } from '../util';
import {
  depthMapToHeightmap,
  type DepthMapHeightmapOptions,
  type DepthMapHeightmapResult,
} from './depth-map-to-heightmap';
import { meshToHeightmap } from './mesh-to-heightmap';

/** Materialization options shared by mesh-backed and depth-map-backed reliefs. */
export type ReliefObjectHeightmapOptions = DepthMapHeightmapOptions;
/** Materialization result shared by mesh-backed and depth-map-backed reliefs. */
export type ReliefObjectHeightmapResult = DepthMapHeightmapResult;

/** Materialize either durable relief source into the shared CAM heightmap. */
export function reliefObjectToHeightmap(
  relief: ReliefObject,
  options: ReliefObjectHeightmapOptions,
): ReliefObjectHeightmapResult {
  if (relief.depthMap !== undefined) return depthMapToHeightmap(relief.depthMap, options);
  return meshToHeightmap(
    { positions: cachedFloat32Array(relief, relief.meshPositions) },
    { ...options, emptyCells: relief.emptyCells },
  );
}
