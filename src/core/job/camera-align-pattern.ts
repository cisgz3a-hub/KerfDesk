// Camera auto-alignment marker pattern (ADR-109, camera v3): the engraveable
// scene for the 2×2 checker patches detectAlignMarkers finds. Five patches —
// a PAIR at the origin corner (rotation disambiguator) and one per remaining
// corner — each contributing two diagonal filled squares whose meeting point
// is the X-corner the detector reads. Pure Scene parts; flows through the
// normal preview/save/start pipeline like the other calibration generators.

import { alignMarkerLayout, type AlignMarkerLayout } from '../camera';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
  type Vec2,
} from '../scene';

export type CameraAlignPatternOptions = {
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly speed?: number;
  readonly power?: number;
};

export type CameraAlignPattern = {
  readonly scene: Scene;
  readonly layer: Layer;
  readonly objects: ReadonlyArray<ImportedSvg>;
  readonly layout: AlignMarkerLayout;
};

// Conservative engrave defaults: dark enough to read on most materials
// without cutting through card. The operator can edit the layer as usual.
const DEFAULT_SPEED_MM_MIN = 3000;
const DEFAULT_POWER_PERCENT = 35;
const MARKER_LAYER_COLOR = '#302020';
const MARKER_HATCH_SPACING_MM = 0.2;

/** Build the engraveable marker pattern and the layout it realizes. */
export function generateCameraAlignPattern(options: CameraAlignPatternOptions): CameraAlignPattern {
  const layout = alignMarkerLayout(options.bedWidthMm, options.bedHeightMm);
  const layer: Layer = {
    ...createLayer({ id: 'camera-align-markers', color: MARKER_LAYER_COLOR, mode: 'fill' }),
    speed: options.speed ?? DEFAULT_SPEED_MM_MIN,
    power: options.power ?? DEFAULT_POWER_PERCENT,
    hatchSpacingMm: MARKER_HATCH_SPACING_MM,
    fillStyle: 'scanline',
    fillBidirectional: true,
  };
  const objects = patchCenters(layout).flatMap((center, index) =>
    patchSquares(center, layout.patchSquareMm, index),
  );
  return { scene: { objects, layers: [layer] }, layer, objects, layout };
}

// One patch per non-origin target; the origin target gets the pair.
function patchCenters(layout: AlignMarkerLayout): Vec2[] {
  const [origin, ...rest] = layout.targets;
  const half = layout.originPairSeparationMm / 2;
  return [{ x: origin.x - half, y: origin.y }, { x: origin.x + half, y: origin.y }, ...rest];
}

// The two burned squares of a 2×2 checker patch: the (−,−) and (+,+) cells.
// Their shared corner at `center` is the X-corner.
function patchSquares(center: Vec2, squareMm: number, patchIndex: number): ImportedSvg[] {
  const cells: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [0, 0],
  ];
  return cells.map(([cx, cy], cellIndex) => ({
    kind: 'imported-svg',
    id: `camera-align-marker-${patchIndex}-${cellIndex}`,
    source: 'camera-align-pattern',
    bounds: { minX: 0, minY: 0, maxX: squareMm, maxY: squareMm },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: center.x + cx * squareMm,
      y: center.y + cy * squareMm,
    },
    paths: [{ color: MARKER_LAYER_COLOR, polylines: [squarePolyline(squareMm)] }],
  }));
}

function squarePolyline(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
      { x: 0, y: 0 },
    ],
  };
}
