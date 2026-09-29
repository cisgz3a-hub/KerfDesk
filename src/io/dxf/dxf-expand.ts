// Raw-entity grouping + recursive INSERT expansion for the DXF importer
// (Phase H.6). Pure: every function returns fresh collections; the caller
// merges. Colors and layers resolve here because BYBLOCK (ACI 0) and block
// content on layer 0 take the inserting entity's color and layer, which flow
// down the recursion.

import type { CurveSubpath, Polyline, Vec2 } from '../../core/scene';
import { aciToHex, DXF_DEFAULT_COLOR, trueColorToHex } from './dxf-colors';
import {
  arcToPolyline,
  circleToPolyline,
  ellipseToPolyline,
  entityExtrusion,
  firstNumber,
  firstString,
  hasUnreadableGeometry,
  lineToPolyline,
  lwpolylineToPolyline,
  polylineEntityToPolyline,
  splineToPolyline,
  type EntityConversion,
} from './dxf-entities';
import { mirrorPointX, TILTED_PLANE_NOTE } from './dxf-ocs';
import type { DxfTag } from './dxf-tags';
import {
  dxfInsertGrid,
  isDxfInsertGridWithinBudget,
  MAX_MINSERT_INSTANCES,
} from './dxf-insert-grid';

export type RawEntity = {
  readonly type: string;
  readonly tags: ReadonlyArray<DxfTag>;
  // VERTEX tag runs for classic POLYLINE entities; empty for everything else.
  readonly vertexRuns: ReadonlyArray<ReadonlyArray<DxfTag>>;
};

export type DxfBlock = {
  readonly basePoint: Vec2; // drawing units
  readonly entities: ReadonlyArray<RawEntity>;
};

export type ColoredPolyline = {
  readonly color: string;
  readonly polyline: Polyline;
  readonly curve: CurveSubpath;
};

export type ExpandOutcome = {
  readonly polylines: ReadonlyArray<ColoredPolyline>;
  // Counts of what was not imported: unsupported or unreadable entities by
  // DXF type, and content CAD does not display under the labels below.
  readonly skipped: ReadonlyMap<string, number>;
  readonly notes: ReadonlyArray<string>;
};

export type ExpandContext = {
  readonly scale: number;
  readonly layerColors: ReadonlyMap<string, string>;
  // Upper-case names of layers that are off or frozen.
  readonly hiddenLayers: ReadonlySet<string>;
  readonly blocks: ReadonlyMap<string, DxfBlock>;
};

// What block content inherits from the INSERT that places it: the color
// BYBLOCK content takes, and the (upper-case) layer that content drawn on
// layer 0 resolves to (ezdxf resolve_layer; AutoCAD's layer-0 rule).
export type BlockReference = {
  readonly color: string;
  readonly layer: string;
};

// Skipped-summary labels for content that CAD does not show, read as
// "skipped 3 on hidden layers".
export const SKIPPED_ON_HIDDEN_LAYERS = 'on hidden layers';
export const SKIPPED_IN_PAPER_SPACE = 'in paper space';

const MAX_INSERT_DEPTH = 8;
const ACI_BYBLOCK = 0;
const ACI_BYLAYER = 256;
const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_LAYER = '0';
const PAPER_SPACE_FLAG = 1; // group 67

// Split a section's tag run into entities: each starts at a (0, TYPE) tag.
// Classic POLYLINE absorbs its VERTEX children through SEQEND. Any other
// SEQEND ends an INSERT's ATTRIB list and draws nothing, so it is dropped.
export function groupRawEntities(tags: ReadonlyArray<DxfTag>): ReadonlyArray<RawEntity> {
  const runs: { type: string; tags: DxfTag[] }[] = [];
  for (const tag of tags) {
    if (tag.code === 0) runs.push({ type: tag.value.toUpperCase(), tags: [] });
    else runs.at(-1)?.tags.push(tag);
  }
  const entities: RawEntity[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i] as (typeof runs)[number];
    if (run.type === 'SEQEND') continue;
    if (run.type !== 'POLYLINE') {
      entities.push({ type: run.type, tags: run.tags, vertexRuns: [] });
      continue;
    }
    const vertexRuns: DxfTag[][] = [];
    let j = i + 1;
    while (j < runs.length && (runs[j] as (typeof runs)[number]).type === 'VERTEX') {
      vertexRuns.push((runs[j] as (typeof runs)[number]).tags);
      j += 1;
    }
    if (j < runs.length && (runs[j] as (typeof runs)[number]).type === 'SEQEND') j += 1;
    entities.push({ type: 'POLYLINE', tags: run.tags, vertexRuns });
    i = j - 1;
  }
  return entities;
}

// `reference` is the INSERT whose block holds `entities`, or null for the
// ENTITIES section itself.
export function expandEntities(
  entities: ReadonlyArray<RawEntity>,
  ctx: ExpandContext,
  reference: BlockReference | null,
  depth: number,
): ExpandOutcome {
  const polylines: ColoredPolyline[] = [];
  const skipped = new Map<string, number>();
  const notes: string[] = [];
  for (const entity of entities) {
    // CAD shows a layout's paper-space content (title block, viewport frames)
    // only on that layout, never in the model a part is cut from. Block
    // content lives wherever its INSERT does, so only top-level flags count.
    if (reference === null && isInPaperSpace(entity.tags)) {
      bumpSkipped(skipped, SKIPPED_IN_PAPER_SPACE);
      continue;
    }
    const layer = resolveLayer(entity.tags, reference);
    if (entity.type === 'INSERT') {
      const color = resolveEntityColor(entity.tags, ctx.layerColors, layer, reference);
      const child = expandInsert(entity, ctx, { color, layer }, depth);
      // Nested grids can compose far beyond the engine's function-argument limit.
      for (const polyline of child.polylines) polylines.push(polyline);
      mergeSkipped(skipped, child.skipped);
      for (const note of child.notes) notes.push(note);
      continue;
    }
    // An INSERT's own layer state hides only the content that resolves to
    // that layer (ezdxf resolve_visible), so the check follows the INSERT.
    if (ctx.hiddenLayers.has(layer)) {
      bumpSkipped(skipped, SKIPPED_ON_HIDDEN_LAYERS);
      continue;
    }
    const conversion = convertReadableEntity(entity, ctx.scale);
    if (conversion === null || conversion.kind === 'skip') {
      bumpSkipped(skipped, entity.type);
      if (conversion?.reason !== undefined) notes.push(conversion.reason);
      continue;
    }
    polylines.push({
      color: resolveEntityColor(entity.tags, ctx.layerColors, layer, reference),
      polyline: conversion.polyline,
      curve: conversion.curve,
    });
  }
  return { polylines, skipped, notes };
}

function isInPaperSpace(tags: ReadonlyArray<DxfTag>): boolean {
  return Math.trunc(firstNumber(tags, 67)) === PAPER_SPACE_FLAG;
}

// An entity without group 8 is on layer 0, and layer 0 inside a block means
// the layer of the INSERT that places it.
function resolveLayer(tags: ReadonlyArray<DxfTag>, reference: BlockReference | null): string {
  const layer = (firstString(tags, 8) ?? DEFAULT_LAYER).toUpperCase();
  return layer === DEFAULT_LAYER && reference !== null ? reference.layer : layer;
}

// Reject value-level corruption (a non-numeric or astronomically-large
// geometry coordinate) instead of coercing it to 0 and importing wrong
// geometry — matches LightBurn, which drops unreadable entities.
function convertReadableEntity(entity: RawEntity, scale: number): EntityConversion | null {
  if (hasUnreadableEntityGeometry(entity, scale)) {
    return {
      kind: 'skip',
      reason: `${entity.type} skipped: unreadable or out-of-range coordinate value`,
    };
  }
  return convertEntity(entity, scale);
}

// Classic POLYLINE carries its geometry in VERTEX children, not its own tags,
// so check both. Everything else keeps all geometry on entity.tags.
function hasUnreadableEntityGeometry(entity: RawEntity, scale: number): boolean {
  if (hasUnreadableGeometry(entity.tags, scale)) return true;
  return entity.vertexRuns.some((run) => hasUnreadableGeometry(run, scale));
}

// null = unsupported entity type (counted); EntityConversion otherwise.
function convertEntity(entity: RawEntity, scale: number): EntityConversion | null {
  switch (entity.type) {
    case 'LINE':
      return lineToPolyline(entity.tags, scale);
    case 'CIRCLE':
      return circleToPolyline(entity.tags, scale);
    case 'ARC':
      return arcToPolyline(entity.tags, scale);
    case 'LWPOLYLINE':
      return lwpolylineToPolyline(entity.tags, scale);
    case 'POLYLINE':
      return polylineEntityToPolyline(entity.tags, entity.vertexRuns, scale);
    case 'ELLIPSE':
      return ellipseToPolyline(entity.tags, scale);
    case 'SPLINE':
      return splineToPolyline(entity.tags, scale);
    default:
      return null;
  }
}

// `reference` is this INSERT's own resolved color and layer, which its block
// content inherits.
function expandInsert(
  entity: RawEntity,
  ctx: ExpandContext,
  reference: BlockReference,
  depth: number,
): ExpandOutcome {
  const name = firstString(entity.tags, 2)?.toUpperCase() ?? '';
  const block = ctx.blocks.get(name);
  // Every refusal below drops the block's parts, so each counts as a skipped
  // INSERT as well as leaving a note.
  if (block === undefined) return skippedInsert(`INSERT references unknown block "${name}"`);
  if (depth >= MAX_INSERT_DEPTH) {
    return skippedInsert(
      `INSERT "${name}" skipped: nesting deeper than ${MAX_INSERT_DEPTH} (cycle?)`,
    );
  }
  const extrusion = entityExtrusion(entity.tags);
  if (extrusion === 'tilted') {
    return skippedInsert(`INSERT "${name}" skipped: ${TILTED_PLANE_NOTE}`);
  }
  const grid = dxfInsertGrid(entity.tags);
  if (!isDxfInsertGridWithinBudget(grid)) {
    return skippedInsert(
      `INSERT "${name}" skipped: MINSERT grid has ${grid.instanceCount} instances (maximum ${MAX_MINSERT_INSTANCES})`,
    );
  }
  const child = expandEntities(block.entities, ctx, reference, depth + 1);
  const placed = placeInsertInstances(entity, block, ctx.scale, child.polylines, {
    mirrored: extrusion === 'mirrored',
  });
  return { polylines: placed, skipped: child.skipped, notes: child.notes };
}

function skippedInsert(note: string): ExpandOutcome {
  return { polylines: [], skipped: new Map([['INSERT', 1]]), notes: [note] };
}

// Apply the INSERT transform (scale about the block base point, rotate,
// translate) to already-converted child geometry, once per grid instance
// (MINSERT rows/columns; a plain INSERT is the 1×1 case). The insertion
// point, rotation and grid are in the INSERT's OCS; for the extrusion
// (0,0,-1) that OCS is world XY mirrored in X (see dxf-ocs), so the placed
// point is mirrored last.
function placeInsertInstances(
  entity: RawEntity,
  block: DxfBlock,
  scale: number,
  children: ReadonlyArray<ColoredPolyline>,
  ocs: { readonly mirrored: boolean },
): ColoredPolyline[] {
  const insert: Vec2 = {
    x: firstNumber(entity.tags, 10) * scale,
    y: firstNumber(entity.tags, 20) * scale,
  };
  const base: Vec2 = { x: block.basePoint.x * scale, y: block.basePoint.y * scale };
  const scaleX = firstNumber(entity.tags, 41, 1);
  const scaleY = firstNumber(entity.tags, 42, 1);
  const rotation = firstNumber(entity.tags, 50) * DEGREES_TO_RADIANS;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const { columns, rows } = dxfInsertGrid(entity.tags);
  const columnSpacing = firstNumber(entity.tags, 44) * scale;
  const rowSpacing = firstNumber(entity.tags, 45) * scale;

  const out: ColoredPolyline[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const gridX = column * columnSpacing;
      const gridY = row * rowSpacing;
      for (const child of children) {
        const point = (p: Vec2): Vec2 => {
          const localX = (p.x - base.x) * scaleX + gridX;
          const localY = (p.y - base.y) * scaleY + gridY;
          const placed = {
            x: insert.x + localX * cos - localY * sin,
            y: insert.y + localX * sin + localY * cos,
          };
          return ocs.mirrored ? mirrorPointX(placed) : placed;
        };
        out.push({
          color: child.color,
          polyline: {
            closed: child.polyline.closed,
            points: child.polyline.points.map(point),
          },
          curve: transformCurve(child.curve, point),
        });
      }
    }
  }
  return out;
}

function transformCurve(curve: CurveSubpath, point: (value: Vec2) => Vec2): CurveSubpath {
  return {
    start: point(curve.start),
    segments: curve.segments.map((segment) => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return { ...segment, to: point(segment.to) };
    }),
    closed: curve.closed,
  };
}

// `layer` is the entity's resolved layer (see resolveLayer).
function resolveEntityColor(
  tags: ReadonlyArray<DxfTag>,
  layerColors: ReadonlyMap<string, string>,
  layer: string,
  reference: BlockReference | null,
): string {
  const trueColor = firstNumber(tags, 420, Number.NaN);
  if (Number.isFinite(trueColor)) return trueColorToHex(trueColor);
  const inheritedColor = reference?.color ?? null;
  const aci = Math.trunc(firstNumber(tags, 62, ACI_BYLAYER));
  if (aci === ACI_BYBLOCK) return inheritedColor ?? DXF_DEFAULT_COLOR;
  if (aci !== ACI_BYLAYER && aci > 0) return aciToHex(aci);
  return layerColors.get(layer) ?? inheritedColor ?? DXF_DEFAULT_COLOR;
}

function bumpSkipped(skipped: Map<string, number>, type: string): void {
  skipped.set(type, (skipped.get(type) ?? 0) + 1);
}

function mergeSkipped(target: Map<string, number>, source: ReadonlyMap<string, number>): void {
  for (const [type, count] of source) {
    target.set(type, (target.get(type) ?? 0) + count);
  }
}
