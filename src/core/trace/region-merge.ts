// Region Enhance merge: swap the re-traced subpaths of a box into a full trace.
//
// Containment decides almost everything (ADR-113): an original subpath fully
// inside the box's interior is dropped, a re-traced one fully inside it is
// added, and everything crossing or outside the interior keeps its original
// geometry. One case needs more than containment. A shape that grazes the
// interior border is traced twice, and the two traces can land a fraction of a
// pixel apart, one on each side of that border. Deciding each copy on its own
// then drops both (a hole in the artwork) or keeps both (a doubled outline
// that an even-odd fill turns into a hole). A re-traced subpath whose bounds
// match an original's within REGION_MATCH_TOLERANCE_PX near the border is the
// same shape, so it follows the original's verdict (ADR-410).
//
// Every surviving subpath keeps its canonical curve and its path keeps its
// operationIds, strokes and fill rule; a path nothing touched is returned as
// the same object.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
} from '../scene';
import type { TraceBoundary } from './trace-boundary';

// Re-traces of one shape on the 1x and 2x grids differ by well under a pixel
// on each side; distinct shapes near the border rarely coincide that closely,
// and the closest pairing wins when they do.
const REGION_MATCH_TOLERANCE_PX = 1;

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Entry = {
  readonly color: string;
  readonly polyline: Polyline;
  readonly curve: CurveSubpath | undefined;
  readonly box: Box | null;
  readonly inside: boolean;
};

/** Drop original subpaths inside `interior`, add re-traced ones inside it, and
 *  fold additions into the first existing path of the same colour. */
export function replacePathsInRegion(
  existing: ReadonlyArray<ColoredPath>,
  interior: TraceBoundary,
  replacement: ReadonlyArray<ColoredPath>,
): ColoredPath[] {
  const originals = existing.map((path) => pathEntries(path, interior));
  const accepted = acceptedReplacements(
    originals.flat(),
    replacement.flatMap((path) => pathEntries(path, interior)),
    interior,
  );
  const out: ColoredPath[] = [];
  const mergedColors = new Set<string>();
  existing.forEach((path, index) => {
    const survivors = (originals[index] ?? []).filter((entry) => !entry.inside);
    const additions = mergedColors.has(path.color)
      ? []
      : accepted.filter((entry) => entry.color === path.color);
    mergedColors.add(path.color);
    if (survivors.length === path.polylines.length && additions.length === 0) {
      out.push(path);
      return;
    }
    const merged = withEntries(path, [...survivors, ...additions]);
    if (merged !== null) out.push(merged);
  });
  for (const path of replacement) {
    if (mergedColors.has(path.color)) continue;
    mergedColors.add(path.color);
    const merged = withEntries(
      { color: path.color, polylines: [] },
      accepted.filter((entry) => entry.color === path.color),
    );
    if (merged !== null) out.push(merged);
  }
  return out;
}

function acceptedReplacements(
  originals: ReadonlyArray<Entry>,
  replacements: ReadonlyArray<Entry>,
  interior: TraceBoundary,
): Entry[] {
  const verdict = new Map<Entry, boolean>();
  for (const [original, retraced] of borderPairs(originals, replacements, interior)) {
    verdict.set(retraced, original.inside);
  }
  return replacements.filter((entry) => verdict.get(entry) ?? entry.inside);
}

// Closest-first one-to-one pairing of subpaths within tolerance of the border.
function borderPairs(
  originals: ReadonlyArray<Entry>,
  replacements: ReadonlyArray<Entry>,
  interior: TraceBoundary,
): Array<readonly [Entry, Entry]> {
  const nearOriginals = originals.filter((entry) => nearBorder(entry.box, interior));
  const nearReplacements = replacements.filter((entry) => nearBorder(entry.box, interior));
  const candidates: Array<{
    readonly original: Entry;
    readonly retraced: Entry;
    readonly d: number;
  }> = [];
  for (const retraced of nearReplacements) {
    for (const original of nearOriginals) {
      if (original.color !== retraced.color) continue;
      if (original.polyline.closed !== retraced.polyline.closed) continue;
      const d = boxDistance(original.box, retraced.box);
      if (d <= REGION_MATCH_TOLERANCE_PX) candidates.push({ original, retraced, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const used = new Set<Entry>();
  const pairs: Array<readonly [Entry, Entry]> = [];
  for (const { original, retraced } of candidates) {
    if (used.has(original) || used.has(retraced)) continue;
    used.add(original);
    used.add(retraced);
    pairs.push([original, retraced]);
  }
  return pairs;
}

function pathEntries(path: ColoredPath, interior: TraceBoundary): Entry[] {
  // Curves are index-aligned with polylines; a mismatched array is not.
  const curves = path.curves?.length === path.polylines.length ? path.curves : undefined;
  return path.polylines.map((polyline, index) => {
    const box = polylineBox(polyline);
    return {
      color: path.color,
      polyline,
      curve: curves?.[index],
      box,
      inside: box !== null && boxInside(box, interior, 0),
    };
  });
}

function withEntries(template: ColoredPath, entries: ReadonlyArray<Entry>): ColoredPath | null {
  if (entries.length === 0) return null;
  const { polylines: _polylines, curves: _curves, ...rest } = template;
  const curved = entries.some((entry) => entry.curve !== undefined);
  return {
    ...rest,
    polylines: entries.map((entry) => entry.polyline),
    ...(curved
      ? { curves: entries.map((entry) => entry.curve ?? polylineToCurveSubpath(entry.polyline)) }
      : {}),
  };
}

// Inside the interior grown by the tolerance, but not inside it shrunk by it.
function nearBorder(box: Box | null, interior: TraceBoundary): boolean {
  if (box === null) return false;
  return (
    boxInside(box, interior, -REGION_MATCH_TOLERANCE_PX) &&
    !boxInside(box, interior, REGION_MATCH_TOLERANCE_PX)
  );
}

function boxInside(box: Box, region: TraceBoundary, inset: number): boolean {
  return (
    box.minX >= region.x + inset &&
    box.minY >= region.y + inset &&
    box.maxX <= region.x + region.width - inset &&
    box.maxY <= region.y + region.height - inset
  );
}

function boxDistance(a: Box | null, b: Box | null): number {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(a.minX - b.minX),
    Math.abs(a.minY - b.minY),
    Math.abs(a.maxX - b.maxX),
    Math.abs(a.maxY - b.maxY),
  );
}

function polylineBox(polyline: Polyline): Box | null {
  if (polyline.points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of polyline.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}
