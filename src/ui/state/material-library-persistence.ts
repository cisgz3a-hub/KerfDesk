// Session persistence for the material library (WORKFLOW.md F-ML1).
//
// LightBurn keeps loaded .clb libraries across restarts; without this, a
// library lives only in Zustand memory and every preset is silently lost
// on reload — the exact data loss the 2026-06-10 feature audit reproduced
// live. The library is app-level state (deliberately NOT part of the .lf2
// project file), so it persists in localStorage beside the autosave slot,
// re-using the io serializer so the stored payload is byte-identical to a
// Save... file and goes through the same schema validation on the way in.

import {
  deserializeMaterialLibrary,
  serializeMaterialLibrary,
  type MaterialLibraryDocument,
} from '../../io/material-library';

export const MATERIAL_LIBRARY_STORAGE_KEY = 'laserforge.material-library.v1';

export type PersistedMaterialLibrary = {
  readonly library: MaterialLibraryDocument;
  readonly dirty: boolean;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type Envelope = {
  readonly dirty: boolean;
  readonly payload: string;
};

// Returns false instead of throwing so the caller can surface a single
// warning toast — a quota failure must not break the mutation that
// triggered the write (same posture as autosave, M16).
export function persistMaterialLibrary(
  storage: StorageLike,
  library: MaterialLibraryDocument | null,
  dirty: boolean,
): boolean {
  try {
    if (library === null) {
      storage.removeItem(MATERIAL_LIBRARY_STORAGE_KEY);
      return true;
    }
    const envelope: Envelope = { dirty, payload: serializeMaterialLibrary(library) };
    storage.setItem(MATERIAL_LIBRARY_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

// Invalid slots are cleared so a corrupt write cannot re-fail every boot.
export function restoreMaterialLibrary(storage: StorageLike): PersistedMaterialLibrary | null {
  let raw: string | null;
  try {
    raw = storage.getItem(MATERIAL_LIBRARY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  const envelope = parseEnvelope(raw);
  if (envelope === null) {
    clearSlot(storage);
    return null;
  }

  const result = deserializeMaterialLibrary(envelope.payload);
  if (result.kind !== 'ok') {
    clearSlot(storage);
    return null;
  }
  return { library: result.library, dirty: envelope.dirty };
}

function parseEnvelope(raw: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const dirty = (parsed as Record<string, unknown>)['dirty'];
  const payload = (parsed as Record<string, unknown>)['payload'];
  if (typeof dirty !== 'boolean' || typeof payload !== 'string') return null;
  return { dirty, payload };
}

function clearSlot(storage: StorageLike): void {
  try {
    storage.removeItem(MATERIAL_LIBRARY_STORAGE_KEY);
  } catch {
    // Removal is best-effort; restore already returned null.
  }
}
