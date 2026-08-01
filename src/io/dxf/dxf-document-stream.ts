import { aciToHex, DXF_DEFAULT_COLOR } from './dxf-colors';
import { firstNumber, firstString } from './dxf-entities';
import {
  expandEntities,
  type ColoredPolyline,
  type DxfBlock,
  type ExpandOutcome,
  type RawEntity,
} from './dxf-expand';
import { createRawEntityStream, type RawEntityStream } from './dxf-raw-entity-stream';
import { buildDxfResult, type ParseDxfResult } from './dxf-result';
import type { DxfTag } from './dxf-tags';

export type DxfMetadata = {
  readonly scale: number;
  readonly layerColors: ReadonlyMap<string, string>;
  readonly blocks: ReadonlyMap<string, DxfBlock>;
  readonly notes: ReadonlyArray<string>;
};

export type DxfTagCollector<T> = {
  readonly pushTag: (tag: DxfTag) => void;
  readonly finish: () => T;
};

const INSUNITS_TO_MM: Readonly<Record<number, number>> = {
  0: 1,
  1: 25.4,
  2: 304.8,
  4: 1,
  5: 10,
  6: 1000,
  9: 0.0254,
  10: 914.4,
  13: 0.001,
  14: 100,
};

export function createDxfMetadataCollector(): DxfTagCollector<DxfMetadata> {
  const units = createUnitCollector();
  const layerColors = new Map<string, string>();
  const blocks = new Map<string, DxfBlock>();
  const blockCollector = createBlockCollector(blocks);
  let entityStream: RawEntityStream | null = null;

  const router = createSectionRouter(
    (section) => {
      entityStream?.finish();
      entityStream = null;
      if (section === 'HEADER') units.reset();
      else if (section === 'TABLES') {
        layerColors.clear();
        entityStream = createRawEntityStream((entity) => readLayer(layerColors, entity));
      } else if (section === 'BLOCKS') {
        blocks.clear();
        blockCollector.reset();
        entityStream = createRawEntityStream(blockCollector.push);
      }
    },
    (section, tag) => {
      if (section === 'HEADER') units.push(tag);
      else if (section === 'TABLES' || section === 'BLOCKS') entityStream?.pushTag(tag);
    },
    () => {
      entityStream?.finish();
      entityStream = null;
    },
  );

  return {
    pushTag: router.pushTag,
    finish: () => {
      router.finish();
      return {
        scale: units.scale(),
        layerColors,
        blocks,
        notes: units.notes(),
      };
    },
  };
}

function createUnitCollector(): {
  readonly reset: () => void;
  readonly push: (tag: DxfTag) => void;
  readonly scale: () => number;
  readonly notes: () => ReadonlyArray<string>;
} {
  let scale = 1;
  let resolved = false;
  let awaitingValue = false;
  let unrecognized: number | null = null;
  const reset = (): void => {
    scale = 1;
    resolved = false;
    awaitingValue = false;
    unrecognized = null;
  };
  const push = (tag: DxfTag): void => {
    if (resolved) return;
    if (!awaitingValue) {
      if (tag.code === 9 && tag.value.toUpperCase() === '$INSUNITS') awaitingValue = true;
      return;
    }
    awaitingValue = false;
    resolved = true;
    if (tag.code !== 70) return;
    const value = Math.trunc(Number.parseFloat(tag.value));
    const knownScale = INSUNITS_TO_MM[value];
    if (knownScale === undefined) unrecognized = value;
    else scale = knownScale;
  };
  const notes = (): ReadonlyArray<string> =>
    unrecognized === null
      ? []
      : [`Unrecognized $INSUNITS ${unrecognized} \u2014 assuming millimeters.`];
  return { reset, push, scale: () => scale, notes };
}

function readLayer(colors: Map<string, string>, entity: RawEntity): void {
  if (entity.type !== 'LAYER') return;
  const name = firstString(entity.tags, 2);
  if (name === null) return;
  const aci = Math.abs(Math.trunc(firstNumber(entity.tags, 62, 7)));
  colors.set(name.toUpperCase(), aci > 0 ? aciToHex(aci) : DXF_DEFAULT_COLOR);
}

function createBlockCollector(blocks: Map<string, DxfBlock>): {
  readonly reset: () => void;
  readonly push: (entity: RawEntity) => void;
} {
  let current: {
    name: string | null;
    basePoint: { x: number; y: number };
    entities: RawEntity[];
  } | null = null;
  const push = (entity: RawEntity): void => {
    if (entity.type === 'BLOCK') {
      current = {
        name: firstString(entity.tags, 2)?.toUpperCase() ?? null,
        basePoint: { x: firstNumber(entity.tags, 10), y: firstNumber(entity.tags, 20) },
        entities: [],
      };
    } else if (entity.type === 'ENDBLK') {
      if (current !== null && current.name !== null) {
        blocks.set(current.name, { basePoint: current.basePoint, entities: current.entities });
      }
      current = null;
    } else current?.entities.push(entity);
  };
  return { reset: () => (current = null), push };
}

export function createDxfEntityCollector(
  metadata: DxfMetadata,
  args: { readonly id: string; readonly source: string },
): DxfTagCollector<ParseDxfResult> {
  let polylines: ColoredPolyline[] = [];
  let skipped = new Map<string, number>();
  let notes: string[] = [];
  let entityStream: RawEntityStream | null = null;

  const router = createSectionRouter(
    (section) => {
      entityStream?.finish();
      entityStream = null;
      if (section === 'ENTITIES') {
        polylines = [];
        skipped = new Map();
        notes = [];
        entityStream = createRawEntityStream(readEntity);
      }
    },
    (section, tag) => {
      if (section === 'ENTITIES') entityStream?.pushTag(tag);
    },
    () => {
      entityStream?.finish();
      entityStream = null;
    },
  );

  function readEntity(entity: RawEntity): void {
    const expanded = expandEntities([entity], metadata, null, 0);
    polylines.push(...expanded.polylines);
    notes.push(...expanded.notes);
    for (const [type, count] of expanded.skipped) {
      skipped.set(type, (skipped.get(type) ?? 0) + count);
    }
  }

  return {
    pushTag: router.pushTag,
    finish: () => {
      router.finish();
      const expanded: ExpandOutcome = { polylines, skipped, notes };
      return buildDxfResult(args, expanded, metadata.notes);
    },
  };
}

function createSectionRouter(
  onStart: (section: string) => void,
  onTag: (section: string, tag: DxfTag) => void,
  onEnd: (section: string) => void,
): { readonly pushTag: (tag: DxfTag) => void; readonly finish: () => void } {
  let section: string | null = null;
  let awaitingName = false;

  const endSection = (): void => {
    if (section !== null) onEnd(section);
    section = null;
  };
  const pushTag = (tag: DxfTag): void => {
    if (tag.code === 0 && tag.value === 'SECTION') {
      endSection();
      awaitingName = true;
      return;
    }
    if (awaitingName) {
      awaitingName = false;
      if (tag.code === 2) {
        section = tag.value.toUpperCase();
        onStart(section);
      }
      return;
    }
    if (tag.code === 0 && tag.value === 'ENDSEC') {
      endSection();
      return;
    }
    if (section !== null) onTag(section, tag);
  };
  return { pushTag, finish: endSection };
}
