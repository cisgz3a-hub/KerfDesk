// buildToolpathLines — the toolpath as thick, kind-coloured 3D lines.
//
// WebGL's native line width is capped at 1px on essentially every desktop
// driver, so three's `lines` addons render each segment as camera-facing
// instanced quads instead. Those classes are addons rather than members of the
// three namespace, so they are imported here, dynamically, to stay inside the
// ADR-102 §3 lazy chunk.
//
// One batched LineSegments2 per move kind, not one per move: a job with 4,000
// moves would otherwise be 4,000 draw calls.
//
// Frame: callers pass moves in SCENE frame and the grid's scene-space origin.
// Subtracting that origin puts the path in the removal grid's local frame —
// the same frame the surface mesh is built in — so the single mirror applied
// at the geometry boundary carries both (ADR-254 §2, as corrected).

import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import type * as LineMaterialModule from 'three/examples/jsm/lines/LineMaterial.js';
import type * as LineSegments2Module from 'three/examples/jsm/lines/LineSegments2.js';
import type * as LineSegmentsGeometryModule from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Move3d, Move3dKind } from '../../core/toolpath3d';
import { toolpathLineStyle } from './viewer3d-toolpath-colors';

type ThreeModule = typeof ThreeNamespace;

type LinesAddons = {
  readonly LineSegments2: typeof LineSegments2Module.LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometryModule.LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterialModule.LineMaterial;
};

export type ToolpathLinesHandle = {
  readonly object: Object3D;
  readonly dispose: () => void;
};

// Drawn in this order so cuts land on top of the traversal web rather than
// being buried by it.
const KIND_DRAW_ORDER: readonly Move3dKind[] = ['rapid', 'retract', 'feed-travel', 'plunge', 'cut'];

// Dash lengths are in world units (mm here) because line distances are measured
// in world space even when the width is screen-space.
const DASH_SIZE_MM = 1.6;
const GAP_SIZE_MM = 1.1;

/**
 * Builds one batched fat-line object per move kind.
 *
 * @param three The dynamically-imported three module.
 * @param moves 3D moves in scene frame, from the core toolpath lift.
 * @param originMm Scene-space min corner of the removal grid, subtracted to
 *   put the path in the same local frame as the surface mesh.
 * @returns A group holding the lines, plus a disposer for its GPU resources.
 */
export async function buildToolpathLines(
  three: ThreeModule,
  moves: ReadonlyArray<Move3d>,
  originMm: { readonly x: number; readonly y: number },
): Promise<ToolpathLinesHandle> {
  const addons = await loadLinesAddons();
  const group = new three.Group();
  group.name = 'toolpath';
  const disposers: Array<() => void> = [];

  for (const kind of KIND_DRAW_ORDER) {
    const positions = segmentPositions(moves, kind, originMm);
    if (positions.length === 0) continue;
    const built = buildKindLines(addons, kind, positions);
    group.add(built.object);
    disposers.push(built.dispose);
  }

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}

async function loadLinesAddons(): Promise<LinesAddons> {
  const [segments, geometry, material] = await Promise.all([
    import('three/examples/jsm/lines/LineSegments2.js'),
    import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
    import('three/examples/jsm/lines/LineMaterial.js'),
  ]);
  return {
    LineSegments2: segments.LineSegments2,
    LineSegmentsGeometry: geometry.LineSegmentsGeometry,
    LineMaterial: material.LineMaterial,
  };
}

// LineSegmentsGeometry wants disjoint segment PAIRS, so an n-point polyline
// contributes n-1 pairs with interior points repeated.
function segmentPositions(
  moves: ReadonlyArray<Move3d>,
  kind: Move3dKind,
  originMm: { readonly x: number; readonly y: number },
): number[] {
  const positions: number[] = [];
  for (const move of moves) {
    if (move.kind !== kind) continue;
    for (let index = 1; index < move.points.length; index += 1) {
      const from = move.points[index - 1];
      const to = move.points[index];
      if (from === undefined || to === undefined) continue;
      positions.push(from.x - originMm.x, from.y - originMm.y, from.z);
      positions.push(to.x - originMm.x, to.y - originMm.y, to.z);
    }
  }
  return positions;
}

function buildKindLines(
  addons: LinesAddons,
  kind: Move3dKind,
  positions: readonly number[],
): ToolpathLinesHandle {
  const style = toolpathLineStyle(kind);
  const geometry = new addons.LineSegmentsGeometry();
  geometry.setPositions(Float32Array.from(positions));

  const material = new addons.LineMaterial({
    color: style.color,
    linewidth: style.widthMm,
    // WORLD UNITS, not screen space. LineMaterial's shader only emits its cap
    // extension inside `#ifdef WORLD_UNITS` (verified in the installed r180
    // source), so with screen-space width two segments meeting at a corner
    // have nothing filling the join and leave a wedge-shaped notch — the gap
    // the maintainer spotted. World units cost a constant pixel width at every
    // zoom; capped corners are worth more than that on a cut preview.
    worldUnits: true,
    dashed: style.dashed,
    dashSize: DASH_SIZE_MM,
    gapSize: GAP_SIZE_MM,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    // Traversals are reference marks; letting them occlude the cut they lead
    // into would defeat the point of drawing them recessive.
    depthWrite: style.opacity >= 1,
  });

  const lines = new addons.LineSegments2(geometry, material);
  // Dashes are driven by per-instance line distances, which do not exist until
  // this is called — skipping it renders a dashed material as solid.
  if (style.dashed) lines.computeLineDistances();
  lines.renderOrder = KIND_DRAW_ORDER.indexOf(kind);

  return {
    object: lines,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
