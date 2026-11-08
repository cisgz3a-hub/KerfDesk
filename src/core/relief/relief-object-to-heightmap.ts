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
   * How a mesh source is read: relief CAM passes 'exact-mesh' (ADR-580), so
   * the cutter is solved against the mesh's triangles; previews keep the
   * 'center' default. A heightfield source always takes the highest of the
   * pixels under each cell; under 'exact-mesh' its map also carries the
   * triangulated pixel-centre surface (ADR-580 Amendment 2).
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
    return heightfieldToHeightmap(relief.reliefSource, {
      ...options,
      exactSurface: options.sampling === 'exact-mesh',
    });
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
