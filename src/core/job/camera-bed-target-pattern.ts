// The engraveable bed target for one-photo camera calibration (ADR-441): a
// filled ring at every target mark and a filled disc at each of the three
// anchors, on one fill layer. Pure Scene parts that run through the normal
// preview, Frame and Start pipeline like the other calibration generators.
// Each ring is an outer circle and an inner circle of opposite winding, so
// the scanline fill leaves the hole unburned under either fill rule.

import {
  bedTargetLayoutWithRings,
  DEFAULT_RING_DIAMETER_MM,
  RING_WIDTH_SHARE,
  type BedTargetArea,
  type BedTargetLayout,
  type BedTargetMark,
} from '../camera/target/bed-target';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';

export type CameraBedTargetOptions = {
  readonly area: BedTargetArea;
  /** Outer ring diameter, mm; the grid step follows it (bedTargetLayoutWithRings). */
  readonly ringDiameterMm?: number;
  readonly speed?: number;
  readonly power?: number;
};

export type CameraBedTargetPattern = {
  readonly scene: Scene;
  readonly layer: Layer;
  readonly objects: ReadonlyArray<ImportedSvg>;
  readonly layout: BedTargetLayout;
};

// Dark enough on card or plywood to read at a glance without cutting
// through; the operator can edit the layer like any other before starting.
const DEFAULT_SPEED_MM_MIN = 3000;
const DEFAULT_POWER_PERCENT = 35;
const TARGET_LAYER_COLOR = '#2a2320';
const TARGET_HATCH_SPACING_MM = 0.2;
// Chord error of the circle polylines, mm.
const CIRCLE_SEGMENTS = 48;

export function generateCameraBedTarget(options: CameraBedTargetOptions): CameraBedTargetPattern {
  const layout = bedTargetLayoutWithRings(options.area, options.ringDiameterMm);
  const layer: Layer = {
    ...createLayer({
      id: 'camera-bed-target',
      name: 'Camera calibration target',
      color: TARGET_LAYER_COLOR,
      mode: 'fill',
    }),
    speed: options.speed ?? DEFAULT_SPEED_MM_MIN,
    power: options.power ?? DEFAULT_POWER_PERCENT,
    hatchSpacingMm: TARGET_HATCH_SPACING_MM,
    fillStyle: 'scanline',
    fillBidirectional: true,
  };
  const objects = layout.marks.map((mark) => markObject(mark, layout, layer.id));
  return { scene: { objects, layers: [layer] }, layer, objects, layout };
}

function markObject(
  mark: BedTargetMark,
  layout: BedTargetLayout,
  operationId: string,
): ImportedSvg {
  const outer = layout.ringDiameterMm / 2;
  const inner = outer - layout.ringWidthMm;
  const polylines = mark.anchor
    ? [circle(outer, outer, 1)]
    : [circle(outer, outer, 1), circle(outer, inner, -1)];
  return {
    kind: 'imported-svg',
    id: `camera-bed-target-${mark.col}-${mark.row}`,
    source: 'camera-bed-target',
    operationIds: [operationId],
    bounds: { minX: 0, minY: 0, maxX: 2 * outer, maxY: 2 * outer },
    transform: { ...IDENTITY_TRANSFORM, x: mark.x - outer, y: mark.y - outer },
    paths: [{ color: TARGET_LAYER_COLOR, polylines }],
  };
}

export type CameraNudgeRingOptions = {
  /** Where the ring's centre burns, bed millimetres. */
  readonly centre: { readonly x: number; readonly y: number };
  /** Outer diameter, mm: the calibration target's ring size. */
  readonly ringDiameterMm?: number;
  readonly speed?: number;
  readonly power?: number;
};

/**
 * One ring of the calibration target's size, for the quick nudge fix
 * (ADR-663 Amendment 2): the photo finds it with the same ring detector.
 */
export function generateCameraNudgeRing(options: CameraNudgeRingOptions): Scene {
  const layer: Layer = {
    ...createLayer({
      id: 'camera-nudge-ring',
      name: 'Camera nudge ring',
      color: TARGET_LAYER_COLOR,
      mode: 'fill',
    }),
    speed: options.speed ?? DEFAULT_SPEED_MM_MIN,
    power: options.power ?? DEFAULT_POWER_PERCENT,
    hatchSpacingMm: TARGET_HATCH_SPACING_MM,
    fillStyle: 'scanline',
    fillBidirectional: true,
  };
  const diameter = options.ringDiameterMm ?? DEFAULT_RING_DIAMETER_MM;
  const outer = diameter / 2;
  const inner = outer - diameter * RING_WIDTH_SHARE;
  const ring: ImportedSvg = {
    kind: 'imported-svg',
    id: 'camera-nudge-ring',
    source: 'camera-bed-target',
    operationIds: [layer.id],
    bounds: { minX: 0, minY: 0, maxX: 2 * outer, maxY: 2 * outer },
    transform: { ...IDENTITY_TRANSFORM, x: options.centre.x - outer, y: options.centre.y - outer },
    paths: [
      {
        color: TARGET_LAYER_COLOR,
        polylines: [circle(outer, outer, 1), circle(outer, inner, -1)],
      },
    ],
  };
  return { objects: [ring], layers: [layer] };
}

// A closed circle about (centre, centre) in the object's own frame; `winding`
// 1 runs one way round and -1 the other.
function circle(centre: number, radius: number, winding: 1 | -1): Polyline {
  const points = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i += 1) {
    const angle = (winding * 2 * Math.PI * i) / CIRCLE_SEGMENTS;
    points.push({ x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) });
  }
  return { closed: true, points };
}
