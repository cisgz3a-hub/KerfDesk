import {
  findRegistrationBoxes,
  transformedBBox,
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
  const expected = expectedOutlineSize(geometry);
  return (
    closeEnough(bounds.maxX - bounds.minX, expected.width) &&
    closeEnough(bounds.maxY - bounds.minY, expected.height)
  );
}

function expectedOutlineSize(geometry: CapturedBoardGeometry): {
  readonly width: number;
  readonly height: number;
} {
  switch (geometry.kind) {
    case 'rect':
      return { width: geometry.widthMm, height: geometry.heightMm };
    case 'circle':
      return { width: geometry.radiusMm * 2, height: geometry.radiusMm * 2 };
    case 'polygon':
      return { width: geometry.polygon.widthMm, height: geometry.polygon.heightMm };
  }
}

function outlineKindMatches(
  specKind: string,
  geometryKind: CapturedBoardGeometry['kind'],
): boolean {
  switch (geometryKind) {
    case 'rect':
      return specKind === 'rect';
    case 'circle':
      return specKind === 'ellipse';
    case 'polygon':
      return specKind === 'polyline';
  }
}

function closeEnough(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= OUTLINE_SIZE_TOLERANCE_MM;
}

/** The project holds a Place Board outline (ADR-636): its burn step then holds
 *  Frame and Start while the Place Board page is open. */
export function sceneHasCapturedBoard(scene: Scene): boolean {
  return capturedBoardKind(scene) !== null;
}

/** The shape of the project's Place Board outline, or null when it has none.
 *  Placing and burning work from the project, so they still work after the
 *  project is reopened and the capture session is gone. */
export function capturedBoardKind(scene: Scene): CapturedBoardGeometry['kind'] | null {
  const board = findRegistrationBoxes(scene).find((box) => box.provenance === 'captured-board');
  if (board === undefined) return null;
  if (board.spec.kind === 'ellipse') return 'circle';
  return board.spec.kind === 'polyline' ? 'polygon' : 'rect';
}
