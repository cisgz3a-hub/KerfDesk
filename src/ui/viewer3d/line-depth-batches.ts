// Split equal-colour, unfaded paths by depth shader without copying their
// geometry. Colour lenses and fading keep the original program-order draw.
import type * as ThreeNamespace from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { installXYPlaneDepth, type CoveredGhost } from './line-plane-depth';
import { insertAfter, MAIN } from './line-shader-edits';
import type { TrailUniforms } from './line-trail';
import { COLOR_STRIDE } from './program-lines';

type DepthGroup = readonly [LineSegments2, LineSegments2, LineSegments2];
type GeometryProxy = { geometry: LineSegmentsGeometry };

export type DepthBatches = {
  /** Original solid and ghost first, then their constant-Z and ramp copies. */
  readonly objects: readonly LineSegments2[];
  readonly materials: readonly LineMaterial[];
  readonly lines: GeometryProxy;
  readonly ghost: GeometryProxy & { visible: boolean };
  /** The cached colour and current fade guard, without a colour scan. */
  readonly split: boolean;
  /** Rechecks every shown program colour after a lens repaint. */
  readonly refreshColors: () => void;
  /** Applies the cached colour guard and current trail before render collection. */
  readonly sync: () => void;
};

export function createDepthBatches(args: {
  readonly three: typeof ThreeNamespace;
  readonly LineSegments2: typeof LineSegments2;
  readonly lines: LineSegments2;
  readonly ghost: LineSegments2;
  readonly trail: TrailUniforms;
  readonly colors: Uint16Array;
}): DepthBatches {
  const { three, lines, ghost, trail, colors } = args;
  const solid = depthGroup(args.LineSegments2, lines, 'solid');
  const faint = depthGroup(args.LineSegments2, ghost, 'ghost');
  const fullLines = lines.geometry;
  const fullGhost = ghost.geometry;
  const covered: CoveredGhost = {
    start: trail.trailStart,
    end: trail.trailEnd,
    eligible: (geometry) =>
      geometry === fullGhost &&
      lines.geometry === fullLines &&
      !lines.material.transparent &&
      lines.material.opacity === 1 &&
      lines.material.linewidth >= ghost.material.linewidth &&
      solid.some((object) => object.visible),
  };
  installXYPlaneDepth(three, lines.material, 'fat');
  installXYPlaneDepth(three, ghost.material, 'fat', covered);
  installXYPlaneDepth(three, solid[1].material, 'fat');
  installXYPlaneDepth(three, faint[1].material, 'fat', covered);
  const solidVisible = lines.visible;
  const ghostVisible = { value: ghost.visible };
  let uniform = false;
  const sync = () => {
    const split = uniform && trail.trailFade.value === 0;
    syncGroup(solid, solidVisible, split);
    syncGroup(faint, ghostVisible.value, split);
  };
  const refreshColors = () => {
    uniform = uniformShownColors(colors);
    sync();
  };
  refreshColors();
  const objects = [lines, ghost, solid[1], solid[2], faint[1], faint[2]];
  return {
    objects,
    materials: objects.map((object) => object.material),
    lines: geometryProxy(solid),
    ghost: ghostProxy(faint, ghostVisible, sync),
    get split() {
      return uniform && trail.trailFade.value === 0;
    },
    refreshColors,
    sync,
  };
}

function depthGroup(
  Constructor: typeof LineSegments2,
  original: LineSegments2,
  role: 'solid' | 'ghost',
): DepthGroup {
  if (original.name === '') original.name = 'toolpath-' + role + '-depth-fallback';
  return [
    original,
    splitStroke(Constructor, original, role, true),
    splitStroke(Constructor, original, role, false),
  ];
}

function splitStroke(
  Constructor: typeof LineSegments2,
  original: LineSegments2,
  role: string,
  constant: boolean,
): LineSegments2 {
  const source = original.material;
  const material = source.clone();
  // Material.clone deliberately omits shader hooks. The base trail/filter
  // closures must survive, including their original shared uniform cells.
  material.onBeforeCompile = source.onBeforeCompile;
  material.onBeforeRender = source.onBeforeRender;
  material.customProgramCacheKey = source.customProgramCacheKey;
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.vertexShader = insertAfter(
      shader.vertexShader,
      MAIN,
      `\n  if ( instanceStart.z ${constant ? '!=' : '=='} instanceEnd.z ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
    return;
  }\n`,
    );
  };
  const kind = constant ? 'constant' : 'ramp';
  material.customProgramCacheKey = () => key + '-depth-batch-early-' + kind;
  const object = new Constructor(original.geometry, material);
  object.copy(original, false);
  object.material = material;
  object.onBeforeRender = original.onBeforeRender;
  object.name = 'toolpath-' + role + '-depth-' + kind;
  return object;
}

function geometryProxy(objects: DepthGroup): GeometryProxy {
  return {
    get geometry() {
      return objects[0].geometry;
    },
    set geometry(value: LineSegmentsGeometry) {
      for (const object of objects) object.geometry = value;
    },
  };
}

function ghostProxy(
  objects: DepthGroup,
  visible: { value: boolean },
  sync: () => void,
): GeometryProxy & { visible: boolean } {
  const proxy = geometryProxy(objects);
  return {
    get geometry() {
      return proxy.geometry;
    },
    set geometry(value: LineSegmentsGeometry) {
      proxy.geometry = value;
    },
    get visible() {
      return visible.value;
    },
    set visible(value: boolean) {
      visible.value = value;
      sync();
    },
  };
}

function syncGroup(objects: DepthGroup, visible: boolean, split: boolean): void {
  const original = objects[0];
  original.visible = visible && !split;
  for (const object of [objects[1], objects[2]]) {
    object.visible = visible && split;
    object.renderOrder = original.renderOrder;
    object.material.clippingPlanes = original.material.clippingPlanes;
    object.material.clipIntersection = original.material.clipIntersection;
    object.material.clipShadows = original.material.clipShadows;
    object.material.clipping = original.material.clipping;
  }
}

function uniformShownColors(colors: Uint16Array): boolean {
  if (colors.length % COLOR_STRIDE !== 0) return false;
  let first = -1;
  for (let at = 0; at < colors.length; at += COLOR_STRIDE) {
    if (colors[at + 3] === 0) continue;
    if (first === -1) first = at;
    else if (
      colors[at] !== colors[first] ||
      colors[at + 1] !== colors[first + 1] ||
      colors[at + 2] !== colors[first + 2]
    )
      return false;
  }
  return first !== -1;
}
