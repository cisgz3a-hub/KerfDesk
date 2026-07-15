import { nextOperationColor } from '../../core/scene';

type RawRecord = Record<string, unknown>;

type ExpandedOperations = {
  readonly operations: ReadonlyArray<RawRecord>;
  readonly operationIdsByColor: ReadonlyMap<string, ReadonlyArray<string>>;
};

export function migrateV2OperationBindings(raw: RawRecord): RawRecord {
  const scene = record(raw['scene']);
  if (scene === null) return { ...raw, schemaVersion: 3 };
  const rawLayers = Array.isArray(scene['layers']) ? scene['layers'] : [];
  const rawObjects = Array.isArray(scene['objects']) ? scene['objects'] : [];
  const expanded = expandOperations(rawLayers);
  const boundObjects = rawObjects.map((object) => bindLegacyObject(object, expanded));
  const migrated = migrateObjectOverrides(boundObjects, expanded.operations);
  return {
    ...raw,
    schemaVersion: 3,
    scene: { ...scene, objects: migrated.objects, layers: migrated.operations },
  };
}

function expandOperations(values: ReadonlyArray<unknown>): ExpandedOperations {
  const operations: RawRecord[] = [];
  const operationIdsByColor = new Map<string, string[]>();
  const usedIds = new Set<string>();
  values.forEach((value, index) => {
    const layer = record(value);
    if (layer === null) return;
    const id = uniqueId(stringValue(layer['id'], `operation-${index + 1}`), usedIds);
    const name = stringValue(layer['name'], `Operation ${index + 1}`);
    const base: RawRecord = { ...layer, id, name, subLayers: [] };
    operations.push(base);
    rememberColorOperation(operationIdsByColor, base['color'], id);
    const subLayers = Array.isArray(layer['subLayers']) ? layer['subLayers'] : [];
    subLayers.forEach((subValue, subIndex) => {
      const subLayer = record(subValue);
      const settings = record(subLayer?.['settings']);
      if (subLayer === null || settings === null) return;
      const subId = uniqueId(
        `${id}:${stringValue(subLayer['id'], `operation-${subIndex + 2}`)}`,
        usedIds,
      );
      const operation: RawRecord = {
        ...layer,
        ...settings,
        id: subId,
        name: stringValue(subLayer['label'], `${name} ${subIndex + 2}`),
        color: nextRawOperationColor(operations),
        visible: layer['visible'],
        output: layer['output'] === true && subLayer['enabled'] !== false,
        subLayers: [],
      };
      operations.push(operation);
      rememberColorOperation(operationIdsByColor, layer['color'], subId);
    });
  });
  return { operations, operationIdsByColor };
}

function bindLegacyObject(value: unknown, expanded: ExpandedOperations): unknown {
  const object = record(value);
  if (object === null) return value;
  if (Array.isArray(object['paths'])) {
    if (object['paths'].length === 0) {
      const operationIds = operationIdsForColor(object['color'], expanded.operationIdsByColor);
      return operationIds.length === 0 ? object : { ...object, operationIds };
    }
    return {
      ...object,
      paths: object['paths'].map((path) => bindLegacyPath(path, expanded.operationIdsByColor)),
    };
  }
  const operationIds = operationIdsForColor(object['color'], expanded.operationIdsByColor);
  return operationIds.length === 0 ? object : { ...object, operationIds };
}

function bindLegacyPath(
  value: unknown,
  operationIdsByColor: ReadonlyMap<string, ReadonlyArray<string>>,
): unknown {
  const path = record(value);
  if (path === null) return value;
  const operationIds = operationIdsForColor(path['color'], operationIdsByColor);
  return operationIds.length === 0 ? path : { ...path, operationIds };
}

function migrateObjectOverrides(
  values: ReadonlyArray<unknown>,
  sourceOperations: ReadonlyArray<RawRecord>,
): { readonly objects: ReadonlyArray<unknown>; readonly operations: ReadonlyArray<RawRecord> } {
  const operationsById = new Map(
    sourceOperations.flatMap((operation) =>
      typeof operation['id'] === 'string' ? [[operation['id'], operation] as const] : [],
    ),
  );
  const clonesAfter = new Map<string, RawRecord[]>();
  const allOperations = [...sourceOperations];
  const usedIds = new Set(operationsById.keys());
  const objects = values.map((value, objectIndex) => {
    const object = record(value);
    const override = record(object?.['operationOverride']);
    if (object === null || override === null) return value;
    const boundIds = collectBoundOperationIds(object);
    if (boundIds.length === 0) return value;
    const replacements = new Map<string, string>();
    for (const sourceId of boundIds) {
      const source = operationsById.get(sourceId);
      if (source === undefined) continue;
      const cloneId = uniqueId(
        `${sourceId}:artwork-${stringValue(object['id'], String(objectIndex + 1))}`,
        usedIds,
      );
      const clone = overrideOperation(
        source,
        override,
        cloneId,
        artworkName(object),
        nextRawOperationColor(allOperations),
      );
      allOperations.push(clone);
      replacements.set(sourceId, cloneId);
      clonesAfter.set(sourceId, [...(clonesAfter.get(sourceId) ?? []), clone]);
    }
    if (replacements.size === 0) return value;
    const { operationOverride: _operationOverride, ...rest } = object;
    return replaceBoundOperationIds(rest, replacements);
  });
  return { objects, operations: insertOperationClones(sourceOperations, clonesAfter) };
}

function overrideOperation(
  source: RawRecord,
  override: RawRecord,
  id: string,
  artwork: string,
  color: string,
): RawRecord {
  return {
    ...source,
    ...override,
    id,
    name: `${artwork} - ${stringValue(source['name'], 'Operation')}`,
    color,
    visible: source['visible'],
    output: source['output'],
    subLayers: [],
  };
}

function replaceBoundOperationIds(
  object: RawRecord,
  replacements: ReadonlyMap<string, string>,
): RawRecord {
  const replace = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map((id) => (typeof id === 'string' ? (replacements.get(id) ?? id) : id))
      : value;
  const next: RawRecord = {
    ...object,
    ...(object['operationIds'] === undefined
      ? {}
      : { operationIds: replace(object['operationIds']) }),
  };
  if (!Array.isArray(object['paths'])) return next;
  return {
    ...next,
    paths: object['paths'].map((value) => {
      const path = record(value);
      return path === null || path['operationIds'] === undefined
        ? value
        : { ...path, operationIds: replace(path['operationIds']) };
    }),
  };
}

function collectBoundOperationIds(object: RawRecord): ReadonlyArray<string> {
  const ids: string[] = [];
  appendStringIds(ids, object['operationIds']);
  if (Array.isArray(object['paths'])) {
    for (const value of object['paths']) appendStringIds(ids, record(value)?.['operationIds']);
  }
  return [...new Set(ids)];
}

function insertOperationClones(
  operations: ReadonlyArray<RawRecord>,
  clonesAfter: ReadonlyMap<string, ReadonlyArray<RawRecord>>,
): ReadonlyArray<RawRecord> {
  return operations.flatMap((operation) => {
    const id = operation['id'];
    return typeof id === 'string' ? [operation, ...(clonesAfter.get(id) ?? [])] : [operation];
  });
}

function artworkName(object: RawRecord): string {
  if (object['kind'] === 'text') return stringValue(object['content'], 'Text').slice(0, 32);
  return fileStem(stringValue(object['source'], 'Artwork'));
}

function fileStem(source: string): string {
  const fileName = source.replaceAll('\\', '/').split('/').at(-1) ?? source;
  return fileName.replace(/\.[^.]+$/, '') || 'Artwork';
}

function operationIdsForColor(
  color: unknown,
  operationIdsByColor: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> {
  return typeof color === 'string' ? (operationIdsByColor.get(color.toLowerCase()) ?? []) : [];
}

function rememberColorOperation(
  operationIdsByColor: Map<string, string[]>,
  color: unknown,
  id: string,
): void {
  if (typeof color !== 'string') return;
  const key = color.toLowerCase();
  operationIdsByColor.set(key, [...(operationIdsByColor.get(key) ?? []), id]);
}

function appendStringIds(target: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const id of value) if (typeof id === 'string') target.push(id);
}

function nextRawOperationColor(operations: ReadonlyArray<RawRecord>): string {
  const colors = operations.flatMap((operation) =>
    typeof operation['color'] === 'string' ? [{ color: operation['color'] }] : [],
  );
  return nextOperationColor(colors);
}

function uniqueId(requested: string, used: Set<string>): string {
  if (!used.has(requested)) {
    used.add(requested);
    return requested;
  }
  let suffix = 2;
  while (used.has(`${requested}-${suffix}`)) suffix += 1;
  const id = `${requested}-${suffix}`;
  used.add(id);
  return id;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function record(value: unknown): RawRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}
