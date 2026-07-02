// parseDxf — clean-room ASCII DXF → ImportedSvg pipeline (Phase H.6,
// ADR-094 §2: no parser libraries; WORKFLOW.md F-CNC9).
//
// 1. Tokenize the two-line group-code/value tag stream (dxf-tags).
// 2. Walk sections: HEADER ($INSUNITS → mm scale), TABLES (LAYER colors),
//    BLOCKS (raw entities per block), ENTITIES.
// 3. Expand entities — including recursive INSERTs — into colored
//    polylines in mm (dxf-expand / dxf-entities / dxf-spline).
// 4. Flip DXF's Y-up frame to the canvas frame, normalize the bounding box
//    to (0,0), and bundle into the same SceneObject variant SVG import
//    uses, so both compilers / preview / save apply unchanged.

import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { aciToHex, DXF_DEFAULT_COLOR } from './dxf-colors';
import { firstNumber, firstString } from './dxf-entities';
import {
  expandEntities,
  groupRawEntities,
  type ColoredPolyline,
  type DxfBlock,
} from './dxf-expand';
import { tokenizeDxf, type DxfTag } from './dxf-tags';

export type ParseDxfResult =
  | { readonly kind: 'error'; readonly reason: string }
  | {
      readonly kind: 'ok';
      readonly object: ImportedSvg | null;
      readonly pathCount: number;
      readonly notes: ReadonlyArray<string>;
      // "12 TEXT, 3 HATCH" — null when nothing was skipped.
      readonly skippedSummary: string | null;
    };

// $INSUNITS → millimeters-per-drawing-unit. Unitless files (0) assume mm.
const INSUNITS_TO_MM: Readonly<Record<number, number>> = {
  0: 1,
  1: 25.4, // inches
  2: 304.8, // feet
  4: 1, // millimeters
  5: 10, // centimeters
  6: 1000, // meters
  9: 0.0254, // mils
  10: 914.4, // yards
  13: 0.001, // microns
  14: 100, // decimeters
};

export function parseDxf(args: {
  readonly dxfText: string;
  readonly id: string;
  readonly source: string;
}): ParseDxfResult {
  const tokenized = tokenizeDxf(args.dxfText);
  if (tokenized.kind === 'error') return tokenized;
  const sections = splitSections(tokenized.tags);

  const notes: string[] = [];
  const scale = unitScale(sections.get('HEADER') ?? [], notes);
  const layerColors = layerColorTable(sections.get('TABLES') ?? []);
  const blocks = blockTable(sections.get('BLOCKS') ?? []);
  const entities = groupRawEntities(sections.get('ENTITIES') ?? []);

  const expanded = expandEntities(entities, { scale, layerColors, blocks }, null, 0);
  notes.push(...expanded.notes);
  const skippedSummary = formatSkipped(expanded.skipped);

  const paths = normalizeAndGroup(expanded.polylines);
  if (paths.length === 0) {
    return { kind: 'ok', object: null, pathCount: 0, notes, skippedSummary };
  }
  const bounds = pathsBounds(paths);
  return {
    kind: 'ok',
    object: {
      kind: 'imported-svg',
      id: args.id,
      source: args.source,
      bounds,
      transform: IDENTITY_TRANSFORM,
      paths,
    },
    pathCount: paths.reduce((count, path) => count + path.polylines.length, 0),
    notes,
    skippedSummary,
  };
}

function splitSections(tags: ReadonlyArray<DxfTag>): ReadonlyMap<string, ReadonlyArray<DxfTag>> {
  const sections = new Map<string, ReadonlyArray<DxfTag>>();
  let currentName: string | null = null;
  let currentTags: DxfTag[] = [];
  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i] as DxfTag;
    if (tag.code === 0 && tag.value === 'SECTION') {
      currentName = null;
      currentTags = [];
      const nameTag = tags[i + 1];
      if (nameTag !== undefined && nameTag.code === 2) {
        currentName = nameTag.value.toUpperCase();
        i += 1;
      }
      continue;
    }
    if (tag.code === 0 && tag.value === 'ENDSEC') {
      if (currentName !== null) sections.set(currentName, currentTags);
      currentName = null;
      currentTags = [];
      continue;
    }
    if (currentName !== null) currentTags.push(tag);
  }
  return sections;
}

function unitScale(headerTags: ReadonlyArray<DxfTag>, notes: string[]): number {
  for (let i = 0; i < headerTags.length; i += 1) {
    const tag = headerTags[i] as DxfTag;
    if (tag.code !== 9 || tag.value.toUpperCase() !== '$INSUNITS') continue;
    const valueTag = headerTags[i + 1];
    if (valueTag === undefined || valueTag.code !== 70) return 1;
    const units = Math.trunc(Number.parseFloat(valueTag.value));
    const scale = INSUNITS_TO_MM[units];
    if (scale === undefined) {
      notes.push(`Unrecognized $INSUNITS ${units} — assuming millimeters.`);
      return 1;
    }
    return scale;
  }
  return 1; // no $INSUNITS: unitless, assume mm (F-CNC9 success 2)
}

function layerColorTable(tableTags: ReadonlyArray<DxfTag>): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const entry of groupRawEntities(tableTags)) {
    if (entry.type !== 'LAYER') continue;
    const name = firstString(entry.tags, 2);
    if (name === null) continue;
    // Negative ACI marks the layer "off" in CAD; geometry still imports
    // (visibility is an editor concern), so take the absolute index.
    const aci = Math.abs(Math.trunc(firstNumber(entry.tags, 62, 7)));
    colors.set(name.toUpperCase(), aci > 0 ? aciToHex(aci) : DXF_DEFAULT_COLOR);
  }
  return colors;
}

function blockTable(blockTags: ReadonlyArray<DxfTag>): ReadonlyMap<string, DxfBlock> {
  const blocks = new Map<string, DxfBlock>();
  const runs = groupRawEntities(blockTags);
  let currentName: string | null = null;
  let currentBase = { x: 0, y: 0 };
  let currentEntities: (typeof runs)[number][] = [];
  for (const run of runs) {
    if (run.type === 'BLOCK') {
      currentName = firstString(run.tags, 2)?.toUpperCase() ?? null;
      currentBase = { x: firstNumber(run.tags, 10), y: firstNumber(run.tags, 20) };
      currentEntities = [];
      continue;
    }
    if (run.type === 'ENDBLK') {
      if (currentName !== null) {
        blocks.set(currentName, { basePoint: currentBase, entities: currentEntities });
      }
      currentName = null;
      currentEntities = [];
      continue;
    }
    if (currentName !== null) currentEntities.push(run);
  }
  return blocks;
}

// Flip DXF's Y-up frame to the canvas frame and land the drawing's bounding
// box at (0,0), grouping polylines into one ColoredPath per distinct color
// (first-seen order — deterministic for snapshots).
function normalizeAndGroup(polylines: ReadonlyArray<ColoredPolyline>): ColoredPath[] {
  if (polylines.length === 0) return [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { polyline } of polylines) {
    for (const point of polyline.points) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  const byColor = new Map<string, Polyline[]>();
  for (const { color, polyline } of polylines) {
    const normalized: Polyline = {
      closed: polyline.closed,
      points: polyline.points.map((point) => ({ x: point.x - minX, y: maxY - point.y })),
    };
    const bucket = byColor.get(color);
    if (bucket === undefined) byColor.set(color, [normalized]);
    else bucket.push(normalized);
  }
  return [...byColor.entries()].map(([color, lines]) => ({ color, polylines: lines }));
}

function pathsBounds(paths: ReadonlyArray<ColoredPath>): ImportedSvg['bounds'] {
  let maxX = 0;
  let maxY = 0;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  return { minX: 0, minY: 0, maxX, maxY };
}

function formatSkipped(skipped: ReadonlyMap<string, number>): string | null {
  if (skipped.size === 0) return null;
  return [...skipped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');
}
