// Batched toolpath geometry and draw-count reveal. Camera updates never rebuild it.
import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import { SEG_KIND } from '../../core/gcode-view';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
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
const TRAVEL_OPACITY = 0.35;
const FAT_LINE_PX = 2.5;

export type RevealTargets = {
  activeSegment: number;
  travelVisible: boolean;
  readonly segKind: Uint8Array;
  readonly positions: Float32Array;
  readonly active: ReturnType<typeof lineSegmentsObject>;
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
  } | null;
  readonly solidSource: Uint32Array;
  readonly travel: {
    readonly geometry: ThreeNamespace.BufferGeometry;
    readonly total: number;
  } | null;
  readonly travelSource: Uint32Array;
};

// Rewrites the solid batch's colour attribute in place from a render-model
// segment → rgb function. Returns whether anything was repainted.
export function applyRecolor(
  targets: RevealTargets | null,
  colorOf: (segmentIndex: number) => readonly [number, number, number],
): boolean {
  if (targets?.solid == null) return false;
  const source = targets.solidSource;
  const colors = new Float32Array(source.length * 6);
  for (let entry = 0; entry < source.length; entry += 1) {
    const rgb = colorOf(source[entry] ?? 0);
    for (let end = 0; end < 2; end += 1) {
      const at = entry * 6 + end * 3;
      colors[at] = rgb[0];
      colors[at + 1] = rgb[1];
      colors[at + 2] = rgb[2];
    }
  }
  targets.solid.geometry.setColors(colors);
  return true;
}

// Reveal by draw count only — no buffer reallocation. Fat lines are instanced
// (one instance per segment), thin lines use setDrawRange over vertex pairs.
export function applyReveal(targets: RevealTargets | null, playhead: PlayheadMarker | null): void {
  if (targets === null) return;
  const showAll = playhead === null;
  const partial = playhead?.point != null && playhead.segmentIndex >= 0;
  const completedIndex = (playhead?.segmentIndex ?? -1) - (partial ? 1 : 0);
  if (targets.solid !== null) {
    targets.solid.geometry.instanceCount = showAll
      ? targets.solid.total
      : revealCount(targets.solidSource, completedIndex);
  }
  if (targets.travel !== null) {
    const count = showAll
      ? targets.travel.total
      : revealCount(targets.travelSource, completedIndex);
    targets.travel.geometry.setDrawRange(0, count * 2);
  }
  applyActiveMove(targets, playhead, partial);
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
    const attribute = targets.active.geometry.getAttribute('position');
    const base = playhead.segmentIndex * 6;
    attribute.setXYZ(
      0,
      targets.positions[base] ?? 0,
      targets.positions[base + 1] ?? 0,
      targets.positions[base + 2] ?? 0,
    );
    attribute.setXYZ(1, playhead.point.x, playhead.point.y, playhead.point.z);
    attribute.needsUpdate = true;
    targets.active.geometry.computeBoundingSphere();
  }
}

export function setToolpathTravelVisibility(targets: RevealTargets | null, visible: boolean): void {
  if (targets === null) return;
  targets.travelVisible = visible;
  targets.active.visible =
    targets.activeSegment >= 0 &&
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
  readonly fatMaterial: LineMaterialType | null;
  readonly travelObject: Object3D | null;
  readonly reveal: RevealTargets;
} {
  const buckets = buildSegmentBuckets(args.segments, args.theme);
  const objects: Object3D[] = [];
  let fatMaterial: LineMaterialType | null = null;
  let travelObject: Object3D | null = null;
  let solidTarget: RevealTargets['solid'] = null;
  let travelTarget: RevealTargets['travel'] = null;
  let solidGhost: RevealTargets['solidGhost'] = null;
  let travelGhost: RevealTargets['travelGhost'] = null;
  const active = lineSegmentsObject(args.three, new Float32Array(6), args.theme.arrow, 1, 2);
  active.visible = false;
  objects.push(active);
  if (buckets.solid.count > 0) {
    const geometry = new args.LineSegmentsGeometry();
    geometry.setPositions(buckets.solid.positions);
    geometry.setColors(buckets.solid.colors);
    fatMaterial = new args.LineMaterial({ vertexColors: true, linewidth: FAT_LINE_PX });
    fatMaterial.resolution.set(args.viewWidth, args.viewHeight);
    const lines = new args.LineSegments2(geometry, fatMaterial);
    lines.renderOrder = 1;
    objects.push(lines);
    solidGhost = lineSegmentsObject(args.three, buckets.solid.positions, args.theme.cut, 0.18, -1);
    solidGhost.material.depthWrite = false;
    solidGhost.visible = false;
    objects.push(solidGhost);
    solidTarget = { geometry, total: buckets.solid.count };
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
  }
  return {
    objects,
    fatMaterial,
    travelObject,
    reveal: {
      ...revealTargets(buckets, solidTarget, travelTarget),
      positions: args.segments.positions,
      segKind: args.segments.segKind,
      activeSegment: -1,
      travelVisible: args.travelVisible,
      active,
      solidGhost,
      travelGhost,
    },
  };
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
  });
  const lines = new three.LineSegments(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}
