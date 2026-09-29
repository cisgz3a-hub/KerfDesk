// Builds the ordered fragment entries of an SVG import: consecutive vector
// elements of the same operation mode share one entry, and an image breaks the
// run. Each element appends to the open entry in place. Rebuilding the entry's
// path array per element made an import of N same-mode elements cost N²
// (audit A-06).

import { IDENTITY_TRANSFORM, type ColoredPath, type Polyline } from '../../core/scene';
import type { SvgImportEntry } from './svg-import-fragment';

type Box = { minX: number; minY: number; maxX: number; maxY: number };

type OpenRun = {
  readonly entry: SvgImportEntry;
  readonly mode: 'fill' | 'line';
  readonly paths: ColoredPath[];
  readonly bounds: Box;
};

export type SvgEntryList = {
  readonly entries: SvgImportEntry[];
  readonly identity: { readonly id: string; readonly source: string };
  /** The entry vector elements are appended to, while it is still the last one. */
  run: OpenRun | null;
};

export function createSvgEntryList(
  identity: SvgEntryList['identity'],
  entries: SvgImportEntry[] = [],
): SvgEntryList {
  return { entries, identity, run: null };
}

export function appendVectorEntry(list: SvgEntryList, path: ColoredPath, filled: boolean): void {
  const mode = filled ? 'fill' : 'line';
  const entryPath = filled ? svgFillPath(path) : path;
  const bounds = boundsForPolylines(path.polylines);
  const run = list.run;
  if (run !== null && run.mode === mode && list.entries.at(-1) === run.entry) {
    run.paths.push(entryPath);
    run.bounds.minX = Math.min(run.bounds.minX, bounds.minX);
    run.bounds.minY = Math.min(run.bounds.minY, bounds.minY);
    run.bounds.maxX = Math.max(run.bounds.maxX, bounds.maxX);
    run.bounds.maxY = Math.max(run.bounds.maxY, bounds.maxY);
    return;
  }
  const paths = [entryPath];
  const entry: SvgImportEntry = {
    kind: 'imported-svg',
    id: list.identity.id + '-' + list.entries.length,
    source: list.identity.source,
    bounds,
    transform: IDENTITY_TRANSFORM,
    operationOverride: { mode },
    paths,
  };
  list.entries.push(entry);
  list.run = { entry, mode, paths, bounds };
}

function boundsForPolylines(polylines: readonly Polyline[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const line of polylines)
    for (const point of line.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  return { minX, minY, maxX, maxY };
}

function svgFillPath(path: ColoredPath): ColoredPath {
  // SVG fills implicitly close every subpath and default to nonzero winding.
  // Materialize both meanings only in the new Fill fragment, keeping stroke
  // geometry and the legacy aggregate (including its saved-project defaults).
  return {
    ...path,
    fillRule: path.fillRule ?? 'nonzero',
    polylines: path.polylines.map((line) => ({ ...line, closed: true })),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => ({ ...curve, closed: true })) }),
  };
}
