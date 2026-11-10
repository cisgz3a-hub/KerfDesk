// design-trim — the Trim tool's session transitions and status text
// (ADR-272 Amendment 8, DS-6c), the partner of design-extend.
//
// Hover previews the piece a click would remove; the click trims it as one undo
// step and re-previews whatever is now under the pointer, so trimming a row of
// crossings is a row of clicks.

import {
  applySketchTrim,
  findSketchTrim,
  type SketchTrim,
} from '../../core/design/ops/trim-sketch';
import type { Vec2 } from '../../core/scene';
import { withSketch, type DesignSession } from './design-session';

export const TRIM_PICK_RADIUS_PX = 6;

export function previewTrimSession(
  session: DesignSession,
  at: Vec2,
  toleranceMm: number,
): DesignSession {
  return { ...session, trimPreview: findSketchTrim(session.history.present, at, toleranceMm) };
}

export function trimSessionAt(
  session: DesignSession,
  at: Vec2,
  toleranceMm: number,
  newId: string,
): DesignSession {
  const trim = findSketchTrim(session.history.present, at, toleranceMm);
  if (trim === null) return { ...session, trimPreview: null };
  const next = applySketchTrim(session.history.present, trim, newId);
  return {
    ...withSketch(session, next),
    trimPreview: findSketchTrim(next, at, toleranceMm),
  };
}

export function trimHint(trim: SketchTrim | null): string {
  switch (trim?.reason) {
    case 'ready':
      return 'Click to trim the highlighted piece back to its crossings. Undo restores it.';
    case 'no-boundary':
      return 'Nothing crosses this piece, so there is nothing to trim it back to. Delete removes a whole shape.';
    case 'unsupported':
      return 'Ellipses and round-cornered rectangles cannot be trimmed yet.';
    case undefined:
      return 'Hover a piece between crossings to preview it, then click to trim it. Undo restores it.';
  }
}
