// Tabs placed by hand through a text edit (ADR-494 Amendment 4). A tab names one
// contour by its index, and glyphs have different numbers of contours, so a
// letter put in front leaves the index on another letter's outline, and a letter
// taken away leaves it on nothing.
//
// An edit that keeps the glyph run (size, spacing, alignment, layout) keeps each
// tab: its contour is the same outline at the same index. An edit that changes
// the run (the content, the font, its style or the weld) keeps only the tabs
// whose contour is still that same outline, and drops the rest: it does not
// guess which letter a tab was meant for (ADR-156). Nothing leaves an anchor
// that resolves to no contour.
//
// Pure core — no I/O, no globals, deterministic.

import type { CncTabAnchor, ColoredPath, Polyline, SceneObject, TextObject, Vec2 } from '../scene';

// The same glyph outlined twice differs only by rounding in its placement.
const SAME_OUTLINE_MM = 1e-6;

export type TextEditTabs = {
  readonly fields: Pick<SceneObject, 'cncTabAnchors' | 'laserTabAnchors'>;
  readonly dropped: number;
};

/** The anchors `edited` keeps from the object it replaces, and how many it drops. */
export function textTabAnchorsAfterEdit(before: SceneObject, edited: TextObject): TextEditTabs {
  if (!('paths' in before)) return { fields: {}, dropped: 0 };
  const scale = before.kind === 'text' ? edited.sizeMm / before.sizeMm : 1;
  const sameRun = before.kind === 'text' && sameGlyphRun(before, edited);
  let dropped = 0;
  const kept = <A extends CncTabAnchor>(
    anchors: ReadonlyArray<A> | undefined,
  ): ReadonlyArray<A> | undefined => {
    if (anchors === undefined) return undefined;
    const survivors = anchors.flatMap((anchor) => {
      const old = before.paths[anchor.pathIndex];
      const next = edited.paths[anchor.pathIndex];
      const holds =
        old !== undefined &&
        next !== undefined &&
        old.color === anchor.layerColor &&
        contourSurvives(old, next, anchor.polylineIndex, sameRun, scale);
      if (!holds) {
        dropped += 1;
        return [];
      }
      // A new text colour recolours the path, and a tab follows its path.
      return [anchor.layerColor === next.color ? anchor : { ...anchor, layerColor: next.color }];
    });
    return survivors.length === 0 && anchors.length > 0 ? undefined : survivors;
  };
  const cncTabAnchors = kept(before.cncTabAnchors);
  const laserTabAnchors = kept(before.laserTabAnchors);
  return {
    fields: {
      ...(cncTabAnchors === undefined ? {} : { cncTabAnchors }),
      ...(laserTabAnchors === undefined ? {} : { laserTabAnchors }),
    },
    dropped,
  };
}

function sameGlyphRun(before: TextObject, edited: TextObject): boolean {
  return (
    before.content === edited.content &&
    before.fontKey === edited.fontKey &&
    before.weldOverlaps === edited.weldOverlaps &&
    JSON.stringify(before.textStyle) === JSON.stringify(edited.textStyle)
  );
}

function contourSurvives(
  old: ColoredPath,
  next: ColoredPath,
  polylineIndex: number,
  sameRun: boolean,
  scale: number,
): boolean {
  const nextLine = next.polylines[polylineIndex];
  const oldLine = old.polylines[polylineIndex];
  if (nextLine === undefined || oldLine === undefined || !nextLine.closed) return false;
  return sameRun || sameShape(oldLine, nextLine, scale);
}

// The same points from the same start, wherever the layout put them.
function sameShape(a: Polyline, b: Polyline, scale: number): boolean {
  const first = a.points[0];
  const second = b.points[0];
  if (first === undefined || second === undefined || a.points.length !== b.points.length) {
    return false;
  }
  return a.points.every((point: Vec2, index) => {
    const other = b.points[index] as Vec2;
    return (
      Math.abs((point.x - first.x) * scale - (other.x - second.x)) <= SAME_OUTLINE_MM &&
      Math.abs((point.y - first.y) * scale - (other.y - second.y)) <= SAME_OUTLINE_MM
    );
  });
}
