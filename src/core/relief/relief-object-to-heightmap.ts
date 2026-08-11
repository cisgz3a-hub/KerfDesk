import type { ReliefObject } from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { cachedFloat32Array } from '../util';
import {
  heightfieldToHeightmap,
  type HeightfieldHeightmapOptions,
  type HeightfieldHeightmapResult,
} from './heightfield-to-heightmap';
import { meshToHeightmap } from './mesh-to-heightmap';

/** Materialization options shared by mesh-backed and heightfield-backed reliefs. */
export type ReliefObjectHeightmapOptions = HeightfieldHeightmapOptions;
/** Materialization result shared by mesh-backed and heightfield-backed reliefs. */
export type ReliefObjectHeightmapResult = HeightfieldHeightmapResult;

/** Materialize either durable relief source into the shared CAM heightmap. */
export function reliefObjectToHeightmap(
  relief: ReliefObject,
  options: ReliefObjectHeightmapOptions,
): ReliefObjectHeightmapResult {
  if (!isMeshRelief(relief)) {
    return heightfieldToHeightmap(relief.reliefSource, options);
  }
  const source = relief.reliefSource;
  if (source.intrinsicBounds.kind === 'non-finite-float32-v1') {
    return { kind: 'error', reason: 'Mesh bounds must be finite.' };
  }
  const positions = cachedFloat32Array(source, source.meshPositions);
  return meshToHeightmap(
    { positions, intrinsicBounds: source.intrinsicBounds },
    {
      ...options,
      targetHeightMm: relief.targetHeightMm,
      emptyCells: source.emptyCells,
    },
  );
}

function isMeshRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}
