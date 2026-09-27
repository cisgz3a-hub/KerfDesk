// The move under way during playback (ADR-470), drawn from its start to the
// playhead: a bold line in the arrow colour inside a dark casing, so it reads
// apart from the done moves in their lens colours and the faint moves still
// to come, in both looks.

import type * as ThreeNamespace from 'three';
import type { InterleavedBufferAttribute } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ToolpathBuildArgs } from './scene-toolpath';

const CORE_PX = 4;
const CASING_PX = 8;
const CASING = 0x0d0f12;
const RENDER_ORDER = 3;

export type CurrentMove = {
  readonly object: ThreeNamespace.Group;
  readonly materials: ReadonlyArray<LineMaterial>;
  /** The drawn part of the move: x0 y0 z0 x1 y1 z1. */
  readonly place: (from: ArrayLike<number>, to: ArrayLike<number>) => void;
  /** Start and end as last placed, for tests. */
  readonly positions: () => Float32Array;
};

export function createCurrentMove(
  args: Pick<
    ToolpathBuildArgs,
    'three' | 'LineSegments2' | 'LineSegmentsGeometry' | 'LineMaterial' | 'theme'
  > & { readonly viewWidth: number; readonly viewHeight: number },
): CurrentMove {
  const geometry = new args.LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6));
  const object = new args.three.Group();
  object.visible = false;
  // The casing writes no depth, so the core drawn after it at the same depth
  // is never speckled by it.
  const materials = [
    { color: CASING, linewidth: CASING_PX, depthWrite: false },
    { color: args.theme.arrow, linewidth: CORE_PX },
  ].map((stroke, order) => {
    const material = new args.LineMaterial(stroke);
    material.toneMapped = false;
    material.resolution.set(args.viewWidth, args.viewHeight);
    const line = new args.LineSegments2(geometry, material);
    line.renderOrder = RENDER_ORDER + order;
    // One short move, rewritten every frame: never worth a bounds update.
    line.frustumCulled = false;
    object.add(line);
    return material;
  });
  const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
  const array = start.data.array as Float32Array;
  return {
    object,
    materials,
    place: (from, to) => {
      array.set([from[0] ?? 0, from[1] ?? 0, from[2] ?? 0, to[0] ?? 0, to[1] ?? 0, to[2] ?? 0]);
      start.data.needsUpdate = true;
    },
    positions: () => array,
  };
}
