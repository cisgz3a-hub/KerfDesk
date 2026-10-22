import {
  findRegistrationBoxes,
  transformedBBox,
  outlineBoardShape,
  type CapturedBoardGeometry,
  type Scene,
} from '../../../core/scene';

const OUTLINE_SIZE_TOLERANCE_MM = 1e-3;

export function capturedBoardOutlineMatches(
  scene: Scene,
  outlineId: string | null,
  geometry: CapturedBoardGeometry | null,
): boolean {
  if (outlineId === null || geometry === null) return false;
  const outline = findRegistrationBoxes(scene).find(
    (object) => object.id === outlineId && object.provenance === 'captured-board',
  );
  if (outline === undefined || !outlineKindMatches(outline.spec.kind, geometry.kind)) return false;
  const bounds = transformedBBox(outline);
  const expected = expectedSize(geometry);
  if (expected === null) return false;
  return (
    closeEnough(bounds.maxX - bounds.minX, expected.width) &&
    closeEnough(bounds.maxY - bounds.minY, expected.height)
  );
}

function outlineKindMatches(
  specKind: string,
  geometryKind: CapturedBoardGeometry['kind'],
): boolean {
  if (geometryKind === 'rect') return specKind === 'rect';
  if (geometryKind === 'circle') return specKind === 'ellipse';
  return specKind === 'polyline';
}

function expectedSize(
  geometry: CapturedBoardGeometry,
): { readonly width: number; readonly height: number } | null {
  if (geometry.kind === 'rect') {
    return { width: geometry.widthMm, height: geometry.heightMm };
  }
  if (geometry.kind === 'circle') {
    return { width: geometry.radiusMm * 2, height: geometry.radiusMm * 2 };
  }
  const shape = outlineBoardShape(geometry);
  if (shape === null) return null;
  const xs = shape.pointsMm.map((point) => point.x);
  const ys = shape.pointsMm.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function closeEnough(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= OUTLINE_SIZE_TOLERANCE_MM;
}
