import {
  applySketchExtension,
  findSketchExtension,
  type SketchExtension,
} from '../../core/design/ops/extend-sketch';
import type { Vec2 } from '../../core/scene';
import { withSketch, type DesignSession } from './design-session';

export const EXTEND_PICK_RADIUS_PX = 8;

export function extendSessionAt(
  session: DesignSession,
  at: Vec2,
  toleranceMm: number,
): DesignSession {
  const target = findSketchExtension(session.history.present, at, toleranceMm);
  if (target === null) return { ...session, extendPreview: null };
  const next = applySketchExtension(session.history.present, target);
  return {
    ...withSketch(session, next),
    extendPreview: findSketchExtension(next, at, toleranceMm),
  };
}

export function extensionHint(target: SketchExtension | null): string {
  switch (target?.reason) {
    case 'ready':
      return 'Click to extend this end to the highlighted boundary. Undo restores it.';
    case 'no-boundary':
      return 'No boundary ahead. Nothing will change.';
    case 'already-touching':
      return 'This end already touches a boundary. Nothing will change.';
    case 'overlap':
      return 'The extension overlaps an edge. No single contact to extend to.';
    case 'curved-source':
      return 'This end is curved. Extend currently supports straight line and polyline ends.';
    case undefined:
      return 'Hover an open straight end to preview its extension, then click. Undo restores each extension.';
  }
}
