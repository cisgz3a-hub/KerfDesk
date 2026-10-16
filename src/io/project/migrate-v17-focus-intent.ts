import type { RawProject } from './migrations';

/** Legacy writers had no Focus Z semantics; unknown metadata cannot acquire them. */
export function migrateV17FocusIntent(raw: RawProject): RawProject {
  const scene = record(raw['scene']);
  return {
    ...raw,
    schemaVersion: 18,
    ...(scene !== null && Array.isArray(scene['layers'])
      ? { scene: { ...scene, layers: scene['layers'].map(legacyLayer) } }
      : {}),
  };
}

function legacyLayer(value: unknown): unknown {
  const layer = record(withoutFocus(value));
  if (layer === null) return value;
  const binding = record(layer['materialBinding']);
  return {
    ...layer,
    ...(Array.isArray(layer['subLayers'])
      ? { subLayers: layer['subLayers'].map(legacySubLayer) }
      : {}),
    ...(binding === null
      ? {}
      : { materialBinding: { ...binding, lastResolved: withoutFocus(binding['lastResolved']) } }),
  };
}

function legacySubLayer(value: unknown): unknown {
  const subLayer = record(value);
  return subLayer === null ? value : { ...subLayer, settings: withoutFocus(subLayer['settings']) };
}

function withoutFocus(value: unknown): unknown {
  const settings = record(value);
  if (settings === null) return value;
  const { focusTest: _focus, ...ordinary } = settings;
  return ordinary;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
