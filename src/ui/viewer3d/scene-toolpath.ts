// Batched toolpath geometry and draw-count reveal. Camera updates never rebuild it.
import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import { SEG_KIND } from '../../core/gcode-view';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { addTrail, setTrail, type TrailUniforms } from './line-trail';
import { createCurrentMove, type CurrentMove } from './scene-current-move';
import {
  buildSegmentBuckets,
  revealCount,
  type SegmentBuckets,
  type Viewer3dSegmentsInput,
} from './segment-buckets';
import type { PlayheadMarker } from './viewer3d-scene';
import type { Viewer3dTheme } from './viewer3d-theme';
type ThreeModule = typeof ThreeNamespace;
type Viewer3dSegments = Viewer3dSegmentsInput;
export type TravelLine = ThreeNamespace.LineSegments<
  ThreeNamespace.BufferGeometry,
  ThreeNamespace.LineBasicMaterial
>;
export const TRAVEL_OPACITY = 0.35;
const FAT_LINE_PX = 2.5;

export type RevealTargets = {
  activeSegment: number;
  travelVisible: boolean;
  /** What an old trail fades toward: the background, encoded as the lines are. */
  fadeColor: readonly [number, number, number];
  readonly background: number;
  readonly segKind: Uint8Array;
  /** The same legend mask used to build the solid and travel buckets. */
  readonly moveFilter: Uint8Array | null;
  readonly positions: Float32Array;
  /** The move under way, drawn bold to the playhead (ADR-470). */
  readonly active: CurrentMove;
  readonly solidGhost: ReturnType<typeof lineSegmentsObject> | null;
  readonly travelGhost: ReturnType<typeof lineSegmentsObject> | null;
  readonly solid: {
    // Narrow structural type rather than the addon class: only the instance
    // count (reveal) and colour upload (lenses) are ever touched.
    readonly geometry: {
      instanceCount: number;
      setColors: (colors: Float32Array) => unknown;
    };
    readonly total: number;
    /** Which done moves the playback trail keeps (ADR-470). */
    readonly trail: TrailUniforms;
  } | null;
  readonly solidSource: Uint32Array;
  readonly travel: {
    readonly geometry: ThreeNamespace.BufferGeometry;
    readonly total: number;
  } | null;
  readonly travelSource: Uint32Array;
};

// Rewrites the solid batch's colour attribute in place from a render-model
// segment → rgb function. Returns whether anything was repainted. `encode`
// maps each channel on the way in: Studio passes sRGB-to-linear so its lines
// show their legend colour exactly (ADR-426); Classic passes nothing.
export function applyRecolor(
  targets: RevealTargets | null,
  colorOf: (segmentIndex: number) => readonly [number, number, number],
  encode?: (channel: number) => number,
): boolean {
  if (targets?.solid == null) return false;
  const source = targets.solidSource;
  const colors = new Float32Array(source.length * 6);
  const channel = encode ?? ((value: number): number => value);
  targets.fadeColor = hexRgb(targets.background).map(channel) as [number, number, number];
  for (let entry = 0; entry < source.length; entry += 1) {
    const rgb = colorOf(source[entry] ?? 0);
    const red = channel(rgb[0]);
    const green = channel(rgb[1]);
    const blue = channel(rgb[2]);
    for (let end = 0; end < 2; end += 1) {
      const at = entry * 6 + end * 3;
      colors[at] = red;
      colors[at + 1] = green;
      colors[at + 2] = blue;
    }
  }
  targets.solid.geometry.setColors(colors);
  return true;
}

// Reveal by draw count only — no buffer reallocation. Fat lines are instanced
// (one instance per segment), thin lines use setDrawRange over vertex pairs.
// A trail starts the drawn range later; the ghost still shows what it skips.
export function applyReveal(targets: RevealTargets | null, playhead: PlayheadMarker | null): void {
  if (targets === null) return;
  const partial = playhead?.point != null && playhead.segmentIndex >= 0;
  const drawn = drawnRange(playhead, partial);
  if (targets.solid !== null) {
    const [first, count] = drawn(targets.solidSource, targets.solid.total);
    targets.solid.geometry.instanceCount = count;
    const trailing = playhead?.trailFrom !== undefined;
    setTrail(targets.solid.trail, first, count, trailing ? targets.fadeColor : null);
  }
  if (targets.travel !== null) {
    const [first, count] = drawn(targets.travelSource, targets.travel.total);
    targets.travel.geometry.setDrawRange(first * 2, (count - first) * 2);
  }
  applyActiveMove(targets, playhead, partial);
}

// The [first, end) entries of a bucket drawn bold: the done moves, from the
// trail's first move when there is a trail.
function drawnRange(playhead: PlayheadMarker | null, partial: boolean) {
  const completedIndex = (playhead?.segmentIndex ?? -1) - (partial ? 1 : 0);
  const trailFrom = playhead?.trailFrom ?? 0;
  return (source: Uint32Array, total: number): readonly [number, number] => {
    if (playhead === null) return [0, total];
    const count = revealCount(source, completedIndex);
    return [Math.min(revealCount(source, trailFrom - 1), count), count];
  };
}

function applyActiveMove(
  targets: RevealTargets,
  playhead: PlayheadMarker | null,
  partial: boolean,
): void {
  for (const ghost of [targets.solidGhost, targets.travelGhost]) {
    if (ghost !== null) ghost.visible = playhead !== null;
  }
  targets.activeSegment = partial ? (playhead?.segmentIndex ?? -1) : -1;
  setToolpathTravelVisibility(targets, targets.travelVisible);
  if (partial && playhead?.point != null) {
    const base = playhead.segmentIndex * 6;
    const { point } = playhead;
    targets.active.place(targets.positions.subarray(base, base + 3), [point.x, point.y, point.z]);
  }
}

export function setToolpathTravelVisibility(targets: RevealTargets | null, visible: boolean): void {
  if (targets === null) return;
  targets.travelVisible = visible;
  targets.active.object.visible =
    targets.activeSegment >= 0 &&
    targets.moveFilter?.[targets.activeSegment] !== 0 &&
    (visible || targets.segKind[targets.activeSegment] !== SEG_KIND.travel);
}

export type ToolpathBuildArgs = {
  readonly three: ThreeModule;
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
  readonly segments: Viewer3dSegments;
  readonly theme: Viewer3dTheme;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly travelVisible: boolean;
};

// Solid moves render as vertex-colored fat lines (one batch, per-kind color);
// traversal stays a thin translucent line object under them (LightBurn's
// recessive-rapid convention), toggleable without a geometry rebuild.
export function buildToolpathObjects(args: ToolpathBuildArgs): {
  readonly objects: ReadonlyArray<Object3D>;
  /** Every fat-line material, for the view's size. */
  readonly fatMaterials: ReadonlyArray<LineMaterialType>;
  readonly travelObject: Object3D | null;
  /** The drawn traversal line, whose material the look swaps (ADR-426). */
  readonly travelLine: TravelLine | null;
  readonly reveal: RevealTargets;
} {
  const buckets = buildSegmentBuckets(args.segments, args.theme);
  const objects: Object3D[] = [];
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let travelLine: TravelLine | null = null;
  let solidTarget: RevealTargets['solid'] = null;
  let travelTarget: RevealTargets['travel'] = null;
  let solidGhost: RevealTargets['solidGhost'] = null;
  let travelGhost: RevealTargets['travelGhost'] = null;
  const active = createCurrentMove(args);
  objects.push(active.object);
  if (buckets.solid.count > 0) {
    const solid = buildSolid(args, buckets.solid);
    objects.push(solid.lines, solid.ghost);
    fatMaterial = solid.material;
    solidGhost = solid.ghost;
    solidTarget = solid.target;
  }
  if (buckets.travel.count > 0) {
    const travel = lineSegmentsObject(
      args.three,
      buckets.travel.positions,
      args.theme.travel,
      TRAVEL_OPACITY,
      0,
    );
    travel.visible = args.travelVisible;
    const travelGroup = new args.three.Group();
    travelGroup.visible = args.travelVisible;
    travel.visible = true;
    travelGhost = lineSegmentsObject(
      args.three,
      buckets.travel.positions,
      args.theme.travel,
      0.1,
      -1,
    );
    travelGhost.material.depthWrite = false;
    travelGhost.visible = false;
    travelGroup.add(travel, travelGhost);
    travelObject = travelGroup;
    objects.push(travelGroup);
    travelTarget = { geometry: travel.geometry, total: buckets.travel.count };
    travelLine = travel;
  }
  return {
    objects,
    fatMaterials: fatMaterial === null ? active.materials : [fatMaterial, ...active.materials],
    travelObject,
    travelLine,
    reveal: {
      ...revealTargets(buckets, solidTarget, travelTarget),
      positions: args.segments.positions,
      segKind: args.segments.segKind,
      moveFilter: args.segments.visible ?? null,
      activeSegment: -1,
      travelVisible: args.travelVisible,
      fadeColor: hexRgb(args.theme.background),
      background: args.theme.background,
      active,
      solidGhost,
      travelGhost,
    },
  };
}

// The done moves as fat lines, and their faint copy for the moves to come.
function buildSolid(args: ToolpathBuildArgs, bucket: SegmentBuckets['solid']) {
  const geometry = new args.LineSegmentsGeometry();
  geometry.setPositions(bucket.positions);
  geometry.setColors(bucket.colors);
  const material = new args.LineMaterial({ vertexColors: true, linewidth: FAT_LINE_PX });
  // Studio tone maps its lit tool model; line colours stay exact (ADR-426).
  material.toneMapped = false;
  material.resolution.set(args.viewWidth, args.viewHeight);
  const trail = addTrail(args.three, material);
  const lines = new args.LineSegments2(geometry, material);
  lines.renderOrder = 1;
  const ghost = lineSegmentsObject(args.three, bucket.positions, args.theme.cut, 0.18, -1);
  ghost.material.depthWrite = false;
  ghost.visible = false;
  const target: NonNullable<RevealTargets['solid']> = { geometry, total: bucket.count, trail };
  return { lines, ghost, material, target };
}

function revealTargets(
  buckets: SegmentBuckets,
  solid: RevealTargets['solid'],
  travel: RevealTargets['travel'],
): Pick<RevealTargets, 'solid' | 'solidSource' | 'travel' | 'travelSource'> {
  return {
    solid,
    solidSource: buckets.solid.sourceIndex,
    travel,
    travelSource: buckets.travel.sourceIndex,
  };
}

function lineSegmentsObject(
  three: ThreeModule,
  positions: Float32Array,
  color: number,
  opacity: number,
  renderOrder: number,
): ThreeNamespace.LineSegments<ThreeNamespace.BufferGeometry, ThreeNamespace.LineBasicMaterial> {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(positions, 3));
  const material = new three.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    toneMapped: false,
  });
  const lines = new three.LineSegments(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}

function hexRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
