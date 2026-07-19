import { findRegistrationBoxes, transformedBBox, type Scene } from '../../../core/scene';
import type { CapturedBoardGeometry } from '../../../core/scene/board-verification';

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
  const expected =
    geometry.kind === 'rect'
      ? { width: geometry.widthMm, height: geometry.heightMm }
      : { width: geometry.radiusMm * 2, height: geometry.radiusMm * 2 };
  return (
    closeEnough(bounds.maxX - bounds.minX, expected.width) &&
    closeEnough(bounds.maxY - bounds.minY, expected.height)
  );
}

function outlineKindMatches(
  specKind: string,
  geometryKind: CapturedBoardGeometry['kind'],
): boolean {
  return geometryKind === 'rect' ? specKind === 'rect' : specKind === 'ellipse';
}

function closeEnough(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= OUTLINE_SIZE_TOLERANCE_MM;
}
