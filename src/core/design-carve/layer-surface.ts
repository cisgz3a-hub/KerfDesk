// layer-surface — writes one design layer's target surface into the depth
// grid (ADR-272 Amendment 1 clause 4). Each cut type reuses the law its
// toolpath compiler applies, so the instant preview and the eventual G-code
// cannot disagree about shape:
//   pocket   flat floor at -depthMm over the even-odd region
//   v-carve  z = -min(dist / tan(tip/2), depthMm, coneHeight)  (vcarve-ladder)
//   profile  the REAL offset (profileToolpathPolylines) swept at bit radius
//   engrave  the drawn path swept at bit radius
//   drill    a bit-diameter hole at each circle centre

import { profileToolpathPolylines, type ProfileSide } from '../cnc';
import { entityToPolylines } from '../design';
import type { DesignLayer } from '../design/layers';
import type { CncTool, Polyline } from '../scene';
import type { SketchEntity } from '../design';
import {
  carveLayerTool,
  vBitHalfAngleRad,
  type CarveGrid,
  type DesignCarveInput,
} from './carve-input';
import { stampAlongPolylines, stampDisc } from './disc-stamp';
import { insideDistanceMm } from './distance-transform';
import { rasterizeEvenOdd } from './grid-mask';

export function applyLayerSurface(
  depth: Float32Array,
  grid: CarveGrid,
  layer: DesignLayer,
  entities: ReadonlyArray<SketchEntity>,
  input: DesignCarveInput,
): void {
  const tool = carveLayerTool(input, layer.toolId);
  const cut = -layer.depthMm;
  const polylines = entities.flatMap((entity) => entityToPolylines(entity));
  switch (layer.cutType) {
    case 'pocket':
      return applyMaskFloor(depth, rasterizeEvenOdd(polylines, grid), cut);
    case 'v-carve':
      return applyVCarve(depth, grid, polylines, layer.depthMm, tool);
    case 'engrave':
      return stampAlongPolylines(depth, grid, polylines, tool.diameterMm / 2, cut);
    case 'profile-outside':
      return applyProfile(depth, grid, polylines, 'outside', tool, cut);
    case 'profile-inside':
      return applyProfile(depth, grid, polylines, 'inside', tool, cut);
    case 'profile-on-path':
      return applyProfile(depth, grid, polylines, 'on-path', tool, cut);
    case 'drill':
      return applyDrill(depth, grid, entities, tool, cut);
  }
}

function applyMaskFloor(depth: Float32Array, mask: Uint8Array, cut: number): void {
  for (let index = 0; index < depth.length; index += 1) {
    if (mask[index] !== 1) continue;
    const current = depth[index] ?? 0;
    if (cut < current) depth[index] = cut;
  }
}

// The same clamp chain as vcarve-ladder: groove depth follows boundary
// distance until it hits the layer depth or the bit's cone height, whichever
// is shallower — wide regions flat-floor rather than deepening forever.
function applyVCarve(
  depth: Float32Array,
  grid: CarveGrid,
  polylines: ReadonlyArray<Polyline>,
  depthMm: number,
  tool: CncTool,
): void {
  const mask = rasterizeEvenOdd(polylines, grid);
  const distance = insideDistanceMm(mask, grid);
  const halfAngle = vBitHalfAngleRad(tool);
  const slope = Math.tan(halfAngle);
  const coneHeightMm = slope > 0 ? tool.diameterMm / 2 / slope : depthMm;
  const maxCut = Math.min(depthMm, coneHeightMm);
  // The chamfer transform measures to the nearest outside cell CENTER; the true
  // region boundary lies half a cell closer, so recenter before applying the
  // groove law or every wall previews half a cell too deep.
  const boundaryBiasMm = grid.mmPerCell / 2;
  for (let index = 0; index < depth.length; index += 1) {
    if (mask[index] !== 1) continue;
    const dist = Math.max(0, (distance[index] ?? 0) - boundaryBiasMm);
    const cut = -Math.min(slope > 0 ? dist / slope : maxCut, maxCut);
    const current = depth[index] ?? 0;
    if (cut < current) depth[index] = cut;
  }
}

function applyProfile(
  depth: Float32Array,
  grid: CarveGrid,
  polylines: ReadonlyArray<Polyline>,
  side: ProfileSide,
  tool: CncTool,
  cut: number,
): void {
  const centerlines = profileToolpathPolylines(polylines, side, tool.diameterMm);
  stampAlongPolylines(depth, grid, centerlines, tool.diameterMm / 2, cut);
}

// Drill reads round entities' CENTRES: the hole is the bit's own diameter, so
// the drawn size is already ignored and an ellipse marks a drill point exactly
// as well as a circle. Entities with no centre contribute nothing.
function applyDrill(
  depth: Float32Array,
  grid: CarveGrid,
  entities: ReadonlyArray<SketchEntity>,
  tool: CncTool,
  cut: number,
): void {
  for (const entity of entities) {
    if (entity.kind !== 'circle' && entity.kind !== 'ellipse') continue;
    stampDisc(depth, grid, entity.center, tool.diameterMm / 2, cut);
  }
}
