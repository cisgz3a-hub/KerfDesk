/**
 * T2-88: hash-derived dirty state.
 *
 * Pre-T2-88 the project's dirty flag was a manually-set boolean
 * (`sceneIsDirtyRef.current = true`) toggled at every mutation site.
 * T1-73, T1-74, T1-75 each fixed a forgotten-toggle bug in a
 * different mutation path (delete, text edits, undo/redo). The
 * underlying defect class is structural — any new mutation site is
 * one forgotten line away from the same bug.
 *
 * The right model: dirty is **derived** from a hash comparison.
 *   `dirty = hashSceneForPersistence(scene) !== lastSavedSceneHash`
 *
 * This makes dirty correct by construction:
 *  - new mutation site? doesn't matter — dirty is computed.
 *  - user undoes back to last-saved scene? dirty becomes false
 *    automatically.
 *  - user makes change A → change B → inverse-A → inverse-B (round
 *    trip back to saved state)? dirty becomes false. Manual
 *    flagging cannot do this.
 *
 * This commit ships the **hash + isDirty helper** with tests. The
 * audit's full proposal also migrates every `sceneIsDirtyRef`
 * caller in App.tsx / useFileHandlers / autosave to call
 * `isDirty(scene, lastSavedHash)` instead of reading the ref. That
 * migration is filed as T2-88-followup — 17 caller sites is too
 * large to ram into one commit, and the helper is consumable
 * incrementally.
 */

import type { Scene } from '../core/scene/Scene';
import type { Layer } from '../core/scene/Layer';
import type { SceneObject } from '../core/scene/SceneObject';

/**
 * FNV-1a 32-bit hex of a UTF-16 string. Same shape as the autosave
 * checksum (T2-69's `fnv1a32Hex`) — corruption-strength only, not
 * cryptographic. The threat model here is "did the scene change?",
 * not "did someone tamper with it"; non-cryptographic hashing is
 * the right tool. SHA-256 upgrade tracked under T3-77.
 */
function fnv1a32Hex(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (s.charCodeAt(i) >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Canonicalize a scene to a JSON string suitable for hashing.
 * Only includes fields that meaningfully change the persisted
 * project — selection state, ephemeral cached fields, runtime-
 * only flags are excluded. The same scene must always produce the
 * same canonical string regardless of property iteration order.
 */
function canonicalSceneForHash(scene: Scene): string {
  // The recursive replacer below sorts every object's keys
  // alphabetically. JSON.stringify's `replacer` callback is called
  // for each value being serialized; returning a new object with
  // sorted keys produces a stable string.
  function sortKeys(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    if (typeof value !== 'object') return value;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeys(obj[k]);
    }
    return out;
  }

  // Strip runtime-only fields: selection, dirty flags (none on Scene
  // itself), ephemeral _bounds / _worldTransform on objects.
  const stripped = {
    canvas: scene.canvas,
    layers: scene.layers.map(stripLayer),
    objects: scene.objects.map(stripObject),
    activeLayerId: scene.activeLayerId,
    metadata: stripMetadata(scene.metadata),
    compileOptions: scene.compileOptions,
    startPosition: scene.startPosition,
    material: scene.material,
  };
  return JSON.stringify(sortKeys(stripped));
}

function stripMetadata(m: Scene['metadata']): Record<string, unknown> {
  // Excludes `modified` timestamp because saving updates it; that
  // would prevent the dirty flag from clearing on save without an
  // explicit subsequent commit.
  return {
    name: m.name,
    created: m.created,
    author: m.author,
    notes: m.notes,
    deviceProfileId: m.deviceProfileId,
    deviceProfileSnapshot: m.deviceProfileSnapshot ?? null,
    materialPresetId: m.materialPresetId,
  };
}

function stripLayer(layer: Layer): Record<string, unknown> {
  // Layer.settings is the part that affects compile output; everything
  // else (id, name, color, visibility) is metadata we still want to
  // capture as part of "what was saved".
  return {
    id: layer.id,
    name: layer.name,
    color: layer.color,
    visible: layer.visible,
    locked: layer.locked,
    output: layer.output,
    order: layer.order,
    settings: layer.settings,
    // material & locked status flow through unchanged
  };
}

function stripObject(obj: SceneObject): Record<string, unknown> {
  // Exclude `_bounds` and `_worldTransform` — both are caches,
  // recomputed on demand from the other fields.
  return {
    id: obj.id,
    type: obj.type,
    name: obj.name,
    layerId: obj.layerId,
    parentId: obj.parentId,
    transform: obj.transform,
    geometry: stripGeometry(obj.geometry),
    visible: obj.visible,
    locked: obj.locked,
    powerScale: obj.powerScale,
  };
}

function stripGeometry(g: SceneObject['geometry']): Record<string, unknown> {
  // Strip Uint8Array buffers — they're sources but the canonical
  // form should compare them as content, not by reference. Using
  // a length+first-byte fingerprint keeps the hash cheap; full
  // image-content comparison is overkill for the dirty-flag use
  // case (the user's mutation is already represented by the other
  // geometry fields like brightness/contrast).
  if (g.type === 'image') {
    const img = g as typeof g & {
      grayscaleData?: Uint8Array;
      adjustedData?: Uint8Array;
      processedData?: Uint8Array;
    };
    return {
      type: 'image',
      src: img.src,
      originalWidth: img.originalWidth,
      originalHeight: img.originalHeight,
      cropX: img.cropX,
      cropY: img.cropY,
      cropWidth: img.cropWidth,
      cropHeight: img.cropHeight,
      grayscaleWidth: (img as { grayscaleWidth?: number }).grayscaleWidth ?? null,
      grayscaleHeight: (img as { grayscaleHeight?: number }).grayscaleHeight ?? null,
      brightness: (img as { brightness?: number }).brightness ?? null,
      contrast: (img as { contrast?: number }).contrast ?? null,
      gamma: (img as { gamma?: number }).gamma ?? null,
      invert: (img as { invert?: boolean }).invert ?? null,
      ditherMode: (img as { ditherMode?: string }).ditherMode ?? null,
      // Hash buffer length + first byte as a quick content
      // fingerprint; full content hashing is unnecessary for dirty.
      grayscaleFingerprint: img.grayscaleData
        ? `${img.grayscaleData.length}:${img.grayscaleData[0] ?? 0}`
        : null,
    };
  }
  return g as unknown as Record<string, unknown>;
}

/**
 * Returns a stable hash of the scene's persisted-state-relevant
 * fields. Same scene → same hash regardless of property iteration
 * order or runtime-only state (selection, ephemeral caches).
 */
export function hashSceneForPersistence(scene: Scene): string {
  return fnv1a32Hex(canonicalSceneForHash(scene));
}

/**
 * Returns true when the scene differs from the last-saved scene
 * (by canonical hash). Pass `null` for `lastSavedHash` to mean
 * "never saved" — in which case dirty is true if the scene has any
 * meaningful content (T1-71's "non-empty" intent), otherwise false
 * (an untouched fresh scene shouldn't show "unsaved changes").
 */
export function isDirty(scene: Scene, lastSavedHash: string | null): boolean {
  if (lastSavedHash === null) {
    return hasMeaningfulContent(scene);
  }
  return hashSceneForPersistence(scene) !== lastSavedHash;
}

/**
 * Heuristic: does this scene have user-introduced content beyond
 * the empty default? Used when no save has occurred yet to decide
 * whether to surface "unsaved changes" UI for a brand-new project.
 *
 * Strict check: any object placed → meaningful. The default scene
 * has zero objects.
 */
export function hasMeaningfulContent(scene: Scene): boolean {
  return scene.objects.length > 0;
}
