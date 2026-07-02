// Raw-entity grouping + recursive INSERT expansion for the DXF importer
// (Phase H.6). Pure: every function returns fresh collections; the caller
// merges. Colors resolve here because BYBLOCK (ACI 0) needs the inserting
// entity's color flowing down the recursion.

import type { Polyline, Vec2 } from '../../core/scene';
import { aciToHex, DXF_DEFAULT_COLOR, trueColorToHex } from './dxf-colors';
import {
  arcToPolyline,
  circleToPolyline,
  ellipseToPolyline,
  firstNumber,
  firstString,
  lineToPolyline,
  lwpolylineToPolyline,
  polylineEntityToPolyline,
  splineToPolyline,
  type EntityConversion,
} from './dxf-entities';
import type { DxfTag } from './dxf-tags';

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
};

export type ExpandOutcome = {
  readonly polylines: ReadonlyArray<ColoredPolyline>;
  readonly skipped: ReadonlyMap<string, number>;
  readonly notes: ReadonlyArray<string>;
};

export type ExpandContext = {
  readonly scale: number;
  readonly layerColors: ReadonlyMap<string, string>;
  readonly blocks: ReadonlyMap<string, DxfBlock>;
};

const MAX_INSERT_DEPTH = 8;
const ACI_BYBLOCK = 0;
const ACI_BYLAYER = 256;
const DEGREES_TO_RADIANS = Math.PI / 180;

// Split a section's tag run into entities: each starts at a (0, TYPE) tag.
// Classic POLYLINE absorbs its VERTEX children through SEQEND.
export function groupRawEntities(tags: ReadonlyArray<DxfTag>): ReadonlyArray<RawEntity> {
  const runs: { type: string; tags: DxfTag[] }[] = [];
  for (const tag of tags) {
    if (tag.code === 0) runs.push({ type: tag.value.toUpperCase(), tags: [] });
    else runs.at(-1)?.tags.push(tag);
  }
  const entities: RawEntity[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i] as (typeof runs)[number];
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

export function expandEntities(
  entities: ReadonlyArray<RawEntity>,
  ctx: ExpandContext,
  inheritedColor: string | null,
  depth: number,
): ExpandOutcome {
  const polylines: ColoredPolyline[] = [];
  const skipped = new Map<string, number>();
  const notes: string[] = [];
  for (const entity of entities) {
    if (entity.type === 'INSERT') {
      const child = expandInsert(entity, ctx, inheritedColor, depth);
      polylines.push(...child.polylines);
      mergeSkipped(skipped, child.skipped);
      notes.push(...child.notes);
      continue;
    }
    const conversion = convertEntity(entity, ctx.scale);
    if (conversion === null) {
      bumpSkipped(skipped, entity.type);
      continue;
    }
    if (conversion.kind === 'skip') {
      bumpSkipped(skipped, entity.type);
      if (conversion.reason !== undefined) notes.push(conversion.reason);
      continue;
    }
    polylines.push({
      color: resolveEntityColor(entity.tags, ctx.layerColors, inheritedColor),
      polyline: conversion.polyline,
    });
  }
  return { polylines, skipped, notes };
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

function expandInsert(
  entity: RawEntity,
  ctx: ExpandContext,
  inheritedColor: string | null,
  depth: number,
): ExpandOutcome {
  const name = firstString(entity.tags, 2)?.toUpperCase() ?? '';
  const block = ctx.blocks.get(name);
  if (block === undefined) {
    return {
      polylines: [],
      skipped: new Map(),
      notes: [`INSERT references unknown block "${name}"`],
    };
  }
  if (depth >= MAX_INSERT_DEPTH) {
    return {
      polylines: [],
      skipped: new Map(),
      notes: [`INSERT "${name}" skipped: nesting deeper than ${MAX_INSERT_DEPTH} (cycle?)`],
    };
  }
  const insertColor = resolveEntityColor(entity.tags, ctx.layerColors, inheritedColor);
  const child = expandEntities(block.entities, ctx, insertColor, depth + 1);
  const placed = placeInsertInstances(entity, block, ctx.scale, child.polylines);
  return { polylines: placed, skipped: child.skipped, notes: child.notes };
}

// Apply the INSERT transform (scale about the block base point, rotate,
// translate) to already-converted child geometry, once per grid instance
// (MINSERT rows/columns; a plain INSERT is the 1×1 case).
function placeInsertInstances(
  entity: RawEntity,
  block: DxfBlock,
  scale: number,
  children: ReadonlyArray<ColoredPolyline>,
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
  const columns = Math.max(1, Math.trunc(firstNumber(entity.tags, 70, 1)));
  const rows = Math.max(1, Math.trunc(firstNumber(entity.tags, 71, 1)));
  const columnSpacing = firstNumber(entity.tags, 44) * scale;
  const rowSpacing = firstNumber(entity.tags, 45) * scale;

  const out: ColoredPolyline[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const gridX = column * columnSpacing;
      const gridY = row * rowSpacing;
      for (const child of children) {
        out.push({
          color: child.color,
          polyline: {
            closed: child.polyline.closed,
            points: child.polyline.points.map((p) => {
              const localX = (p.x - base.x) * scaleX + gridX;
              const localY = (p.y - base.y) * scaleY + gridY;
              return {
                x: insert.x + localX * cos - localY * sin,
                y: insert.y + localX * sin + localY * cos,
              };
            }),
          },
        });
      }
    }
  }
  return out;
}

function resolveEntityColor(
  tags: ReadonlyArray<DxfTag>,
  layerColors: ReadonlyMap<string, string>,
  inheritedColor: string | null,
): string {
  const trueColor = firstNumber(tags, 420, Number.NaN);
  if (Number.isFinite(trueColor)) return trueColorToHex(trueColor);
  const aci = Math.trunc(firstNumber(tags, 62, ACI_BYLAYER));
  if (aci === ACI_BYBLOCK) return inheritedColor ?? DXF_DEFAULT_COLOR;
  if (aci !== ACI_BYLAYER && aci > 0) return aciToHex(aci);
  const layerName = firstString(tags, 8);
  if (layerName !== null) {
    const layerColor = layerColors.get(layerName.toUpperCase());
    if (layerColor !== undefined) return layerColor;
  }
  return inheritedColor ?? DXF_DEFAULT_COLOR;
}

function bumpSkipped(skipped: Map<string, number>, type: string): void {
  skipped.set(type, (skipped.get(type) ?? 0) + 1);
}

function mergeSkipped(target: Map<string, number>, source: ReadonlyMap<string, number>): void {
  for (const [type, count] of source) {
    target.set(type, (target.get(type) ?? 0) + count);
  }
}
