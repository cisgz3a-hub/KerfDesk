// The move under way during playback (ADR-470), drawn from its start to the
// playhead: a bold line in the arrow colour inside a dark casing, so it reads
// apart from the done moves in their lens colours and the faint moves still
// to come, in both looks.

import type * as ThreeNamespace from 'three';
import type { InterleavedBufferAttribute } from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { ToolpathBuildArgs } from './scene-toolpath';
import { installXYPlaneDepth } from './line-plane-depth';

const CORE_PX = 4;
const CASING_PX = 8;
const CASING = 0x0d0f12;
const RENDER_ORDER = 3;

type CurrentMoveArgs = Pick<
  ToolpathBuildArgs,
  | 'three'
  | 'LineSegments2'
  | 'LineSegmentsGeometry'
  | 'LineMaterial'
  | 'theme'
  | 'viewWidth'
  | 'viewHeight'
>;

export type CurrentMove = {
  readonly object: ThreeNamespace.Group;
  readonly materials: ReadonlyArray<LineMaterial>;
  /** The drawn part of the move: x0 y0 z0 x1 y1 z1. */
  readonly place: (from: ArrayLike<number>, to: ArrayLike<number>) => void;
  /** Match hardware ramp depth only while completed ramps use that shader. */
  readonly useHardwareDepth: (enabled: boolean) => void;
  /** Start and end as last placed, for tests. */
  readonly positions: () => Float32Array;
};

export function createCurrentMove(args: CurrentMoveArgs, planar: boolean): CurrentMove {
  const geometry = new args.LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(6));
  const exact = currentStrokes(args, geometry, planar);
  // Clone before adding fragment-depth edits: hardware ramps retain the base
  // shader's per-sample MSAA depth, matching the completed hardware ramp batch.
  const hardware = planar ? [] : exact.map((stroke) => hardwareStroke(args, stroke));
  if (!planar) for (const stroke of exact) installXYPlaneDepth(args.three, stroke.material, 'fat');
  const object = new args.three.Group();
  object.visible = false;
  object.add(...exact, ...hardware);
  const start = geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
  const array = start.data.array as Float32Array;
  let hardwareAllowed = false;
  const sync = () => {
    const selected = !planar && hardwareAllowed && array[2] !== array[5];
    for (const stroke of exact) stroke.visible = !selected;
    for (const stroke of hardware) stroke.visible = selected;
  };
  return {
    object,
    materials: [...exact, ...hardware].map((stroke) => stroke.material),
    place: (from, to) => {
      array.set([from[0] ?? 0, from[1] ?? 0, from[2] ?? 0, to[0] ?? 0, to[1] ?? 0, to[2] ?? 0]);
      start.data.needsUpdate = true;
      sync();
    },
    useHardwareDepth: (enabled) => {
      if (planar) return;
      hardwareAllowed = enabled;
      sync();
    },
    positions: () => array,
  };
}

function currentStrokes(
  args: CurrentMoveArgs,
  geometry: LineSegments2['geometry'],
  planar: boolean,
): LineSegments2[] {
  // The casing writes no depth, so the core drawn after it at the same depth
  // is never speckled by it.
  return [
    { color: CASING, linewidth: CASING_PX, depthWrite: false },
    { color: args.theme.arrow, linewidth: CORE_PX },
  ].map((stroke, order) => {
    const material = new args.LineMaterial({
      // The flat toolpath shares one ordered draw queue. Its different stroke
      // directions must not occlude each other through slope-dependent depth.
      transparent: planar,
      blending: planar ? args.three.NoBlending : args.three.NormalBlending,
      depthWrite: !planar,
      ...stroke,
      // Keep depth testing against scene geometry, with a small work-plane bias.
      polygonOffset: planar,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    material.toneMapped = false;
    material.resolution.set(args.viewWidth, args.viewHeight);
    const line = new args.LineSegments2(geometry, material);
    line.renderOrder = RENDER_ORDER + order;
    line.name = 'toolpath-current-exact-' + (order === 0 ? 'casing' : 'core');
    // One short move, rewritten every frame: never worth a bounds update.
    line.frustumCulled = false;
    return line;
  });
}

function hardwareStroke(args: CurrentMoveArgs, source: LineSegments2): LineSegments2 {
  const material = source.material.clone();
  material.onBeforeCompile = source.material.onBeforeCompile;
  material.onBeforeRender = source.material.onBeforeRender;
  const cacheKey = source.material.customProgramCacheKey();
  material.customProgramCacheKey = () => cacheKey;
  const line = new args.LineSegments2(source.geometry, material);
  line.copy(source, false);
  line.material = material;
  line.onBeforeRender = source.onBeforeRender;
  line.name = source.name.replace('-exact-', '-hardware-');
  line.visible = false;
  return line;
}
