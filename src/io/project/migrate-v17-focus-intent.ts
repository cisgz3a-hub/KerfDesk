import type { RawProject } from './migrations';
import { asRecord } from '../../core/util/is-record';

/** Legacy writers had no Focus Z semantics; unknown metadata cannot acquire them. */
export function migrateV17FocusIntent(raw: RawProject): RawProject {
  const scene = asRecord(raw['scene']);
  return {
    ...raw,
    schemaVersion: 18,
    ...(scene !== null && Array.isArray(scene['layers'])
      ? { scene: { ...scene, layers: scene['layers'].map(legacyLayer) } }
      : {}),
  };
}

function legacyLayer(value: unknown): unknown {
  const layer = asRecord(withoutFocus(value));
  if (layer === null) return value;
  const binding = asRecord(layer['materialBinding']);
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
  const subLayer = asRecord(value);
  return subLayer === null ? value : { ...subLayer, settings: withoutFocus(subLayer['settings']) };
}

function withoutFocus(value: unknown): unknown {
  const settings = asRecord(value);
  if (settings === null) return value;
  const { focusTest: _focus, ...ordinary } = settings;
  return ordinary;
}
