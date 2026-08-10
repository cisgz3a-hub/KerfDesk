import type { ReliefObject } from '../scene';
import { cachedFloat32Array } from '../util';
import {
  heightfieldToHeightmap,
  type HeightfieldHeightmapOptions,
  type HeightfieldHeightmapResult,
} from './heightfield-to-heightmap';
import { meshToHeightmap } from './mesh-to-heightmap';
import { FLOATS_PER_TRIANGLE } from './triangle-mesh';

const VALUES_PER_VERTEX = 3;
const Z_VALUE_OFFSET = 2;

/** Materialization options shared by mesh-backed and heightfield-backed reliefs. */
export type ReliefObjectHeightmapOptions = HeightfieldHeightmapOptions;
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
  const positions = cachedFloat32Array(relief.reliefSource, relief.reliefSource.meshPositions);
  const hasNonFiniteZ = positions.length >= FLOATS_PER_TRIANGLE && meshHasNonFiniteZ(positions);
  if (hasNonFiniteZ) return { kind: 'error', reason: 'Mesh bounds must be finite.' };
  return meshToHeightmap({ positions }, { ...options, emptyCells: relief.reliefSource.emptyCells });
}

function meshHasNonFiniteZ(positions: Float32Array): boolean {
  for (let index = Z_VALUE_OFFSET; index < positions.length; index += VALUES_PER_VERTEX) {
    if (!Number.isFinite(positions[index])) return true;
  }
  return false;
}
