// Batched toolpath geometry and draw-count reveal. Camera updates never rebuild it.
import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import { SEG_KIND } from '../../core/gcode-view';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { editLineMaterial, withShownMoves } from './line-shader-edits';
import { addTrail, setTrail, type TrailUniforms } from './line-trail';
import {
  COLOR_STRIDE,
  createProgramGeometry,
  programColors,
  shareProgramGeometry,
  writeProgramColors,
} from './program-lines';
import { createCurrentMove, type CurrentMove } from './scene-current-move';
import { buildTravelBucket, revealCount, type Viewer3dSegmentsInput } from './segment-buckets';
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
const GHOST_PX = 1;
const GHOST_OPACITY = 0.18;

export type RevealTargets = {
  activeSegment: number;
  travelVisible: boolean;
  /** What an old trail fades toward: the background, encoded as the lines are. */
  fadeColor: readonly [number, number, number];
  readonly background: number;
  readonly segKind: Uint8Array;
  /** The same legend mask the drawn moves were built with. */
  readonly moveFilter: Uint8Array | null;
  readonly positions: Float32Array;
  /** The move under way, drawn bold to the playhead (ADR-470). */
  readonly active: CurrentMove;
  /** The faint copy of every solid move shown during playback. */
  readonly solidGhost: { visible: boolean } | null;
  readonly travelGhost: ReturnType<typeof lineSegmentsObject> | null;
  /** The solid moves in program order: instance i is move i (ADR-485). */
  readonly solid: {
    /** The drawn lines' geometry, whose instance count is the reveal. */
    readonly geometry: LineSegmentsGeometryModule.LineSegmentsGeometry;
    /** Every move in the program, shown or not. */
    readonly total: number;
    /** Which done moves the playback trail keeps (ADR-470). */
    readonly trail: TrailUniforms;
    /** Red, green, blue and shown per move, rewritten in place by a lens. */
    readonly colors: Uint16Array;
    readonly colorBuffer: { needsUpdate: boolean };
  } | null;
  readonly travel: {
    readonly geometry: ThreeNamespace.BufferGeometry;
    readonly total: number;
  } | null;
  readonly travelSource: Uint32Array;
};

// Repaints the solid moves in place from a render-model segment → rgb
// function. Returns whether anything was repainted. `encode` maps each
// channel on the way in: Studio passes sRGB-to-linear so its lines show their
// legend colour exactly (ADR-426); Classic passes nothing.
export function applyRecolor(
  targets: RevealTargets | null,
  colorOf: (segmentIndex: number) => readonly [number, number, number],
  encode?: (channel: number) => number,
): boolean {
  if (targets?.solid == null) return false;
  const channel = encode ?? ((value: number): number => value);
  targets.fadeColor = hexRgb(targets.background).map(channel) as [number, number, number];
  writeProgramColors(targets.solid.colors, colorOf, encode);
  targets.solid.colorBuffer.needsUpdate = true;
  return true;
}

// Reveal by draw count only — no buffer reallocation. Fat lines are instanced
// in program order (instance i is move i), thin lines use setDrawRange over
// vertex pairs. A trail starts the drawn range later; the ghost still shows
// what it skips.
export function applyReveal(targets: RevealTargets | null, playhead: PlayheadMarker | null): void {
  if (targets === null) return;
  const partial = playhead?.point != null && playhead.segmentIndex >= 0;
  const drawn = drawnRange(playhead, partial);
  if (targets.solid !== null) {
    const { total } = targets.solid;
    const [first, count] = drawn((index) => Math.min(total, Math.max(0, index + 1)), total);
    targets.solid.geometry.instanceCount = count;
    const trailing = playhead?.trailFrom !== undefined;
    setTrail(targets.solid.trail, first, count, trailing ? targets.fadeColor : null);
  }
  if (targets.travel !== null) {
    const source = targets.travelSource;
    const [first, count] = drawn((index) => revealCount(source, index), targets.travel.total);
    targets.travel.geometry.setDrawRange(first * 2, (count - first) * 2);
  }
  applyActiveMove(targets, playhead, partial);
}

// The [first, end) entries of a batch drawn bold: the done moves, from the
// trail's first move when there is a trail. `through(i)` counts the batch's
// entries for moves 0 to i.
function drawnRange(playhead: PlayheadMarker | null, partial: boolean) {
  const completedIndex = (playhead?.segmentIndex ?? -1) - (partial ? 1 : 0);
  const trailFrom = playhead?.trailFrom ?? 0;
  return (through: (index: number) => number, total: number): readonly [number, number] => {
    if (playhead === null) return [0, total];
    const count = through(completedIndex);
    return [Math.min(through(trailFrom - 1), count), count];
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
  const travelBucket = buildTravelBucket(args.segments);
  const program = programColors(args.segments, args.theme);
  const objects: Object3D[] = [];
  let fatMaterials: LineMaterialType[] = [];
  let travelObject: Object3D | null = null;
  let travelLine: TravelLine | null = null;
  let solidTarget: RevealTargets['solid'] = null;
  let travelTarget: RevealTargets['travel'] = null;
  let solidGhost: RevealTargets['solidGhost'] = null;
  let travelGhost: RevealTargets['travelGhost'] = null;
  const active = createCurrentMove(args);
  objects.push(active.object);
  if (program.shown > 0) {
    const solid = buildSolid(args, program.colors);
    objects.push(solid.lines, solid.ghost);
    fatMaterials = solid.materials;
    solidGhost = solid.ghost;
    solidTarget = solid.target;
  }
  if (travelBucket.count > 0) {
    const travel = lineSegmentsObject(
      args.three,
      travelBucket.positions,
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
      travelBucket.positions,
      args.theme.travel,
      0.1,
      -1,
    );
    travelGhost.material.depthWrite = false;
    travelGhost.visible = false;
    travelGroup.add(travel, travelGhost);
    travelObject = travelGroup;
    objects.push(travelGroup);
    travelTarget = { geometry: travel.geometry, total: travelBucket.count };
    travelLine = travel;
  }
  return {
    objects,
    fatMaterials: [...fatMaterials, ...active.materials],
    travelObject,
    travelLine,
    reveal: {
      solid: solidTarget,
      travel: travelTarget,
      travelSource: travelBucket.sourceIndex,
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

// The done moves as fat lines, and their faint copy for the moves to come,
// both drawn from one GPU copy of the program (ADR-485).
function buildSolid(args: ToolpathBuildArgs, colors: Uint16Array) {
  const { geometry, colorBuffer } = createProgramGeometry(
    args.three,
    args.LineSegmentsGeometry,
    args.segments.positions,
    colors,
  );
  const material = fatLineMaterial(args, { vertexColors: true, linewidth: FAT_LINE_PX });
  const trail = addTrail(args.three, material);
  const lines = new args.LineSegments2(geometry, material);
  lines.renderOrder = 1;
  const ghostMaterial = fatLineMaterial(args, {
    color: args.theme.cut,
    linewidth: GHOST_PX,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
  });
  editLineMaterial(ghostMaterial, 'kerfdesk-shown-moves', withShownMoves);
  const ghost = new args.LineSegments2(
    shareProgramGeometry(args.LineSegmentsGeometry, geometry),
    ghostMaterial,
  );
  ghost.renderOrder = -1;
  ghost.visible = false;
  const target: NonNullable<RevealTargets['solid']> = {
    geometry,
    total: colors.length / COLOR_STRIDE,
    trail,
    colors,
    colorBuffer,
  };
  return { lines, ghost, materials: [material, ghostMaterial], target };
}

// Studio tone maps its lit tool model; line colours stay exact (ADR-426).
function fatLineMaterial(
  args: ToolpathBuildArgs,
  parameters: ConstructorParameters<typeof LineMaterialModule.LineMaterial>[0],
): LineMaterialType {
  const material = new args.LineMaterial(parameters);
  material.toneMapped = false;
  material.resolution.set(args.viewWidth, args.viewHeight);
  return material;
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
