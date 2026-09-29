import type { ReliefObject } from '../scene';
import { cachedFinitePreservingFloatArray } from '../util';
import {
  heightfieldToHeightmap,
  type HeightfieldHeightmapOptions,
  type HeightfieldHeightmapResult,
} from './heightfield-to-heightmap';
import { meshToHeightmap, type MeshSampling } from './mesh-to-heightmap';

/** Materialization options shared by mesh-backed and heightfield-backed reliefs. */
export type ReliefObjectHeightmapOptions = HeightfieldHeightmapOptions & {
  /**
   * How a mesh source is read (ADR-412 Amendment 1): relief CAM passes
   * 'footprint-max', previews keep the 'center' default. A heightfield source
   * always takes the highest of the pixels under each cell.
   */
  readonly sampling?: MeshSampling;
};
/** Materialization result shared by mesh-backed and heightfield-backed reliefs. */
export type ReliefObjectHeightmapResult = HeightfieldHeightmapResult;

/** Materialize either durable relief source into the shared CAM heightmap. */
export function reliefObjectToHeightmap(
  relief: ReliefObject,
  options: ReliefObjectHeightmapOptions,
): ReliefObjectHeightmapResult {
  if (relief.reliefSource.kind === 'heightfield-v1') {
    return heightfieldToHeightmap(relief.reliefSource, options);
  }
  return meshToHeightmap(
    {
      positions: cachedFinitePreservingFloatArray(
        relief.reliefSource,
        relief.reliefSource.meshPositions,
      ),
    },
    { ...options, emptyCells: relief.reliefSource.emptyCells },
  );
}
