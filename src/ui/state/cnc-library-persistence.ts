// App-level CNC library persistence (Phase H.7, F-CNC11–13): custom bits,
// feeds/speeds presets, and named machine profiles live BESIDE projects —
// deliberately not in .lf2 (the material-library precedent) — so one
// operator's bit drawer and dialed-in feeds follow them across projects.
// Stored in localStorage with the same safe-parse / clear-on-corrupt
// posture as the material library slot.

import type { CncLayerSettings, CncMachineConfig, CncTool, CncToolKind } from '../../core/scene';

export const CNC_LIBRARY_STORAGE_KEY = 'laserforge.cnc-library.v1';

// The feeds/speeds a preset captures — the "how fast" half of a layer's
// CNC settings (cut type / depth / tabs stay per-layer).
export type CncFeedPreset = {
  readonly id: string;
  readonly name: string;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
  readonly stepoverPercent: number;
};

export type CncMachineProfile = {
  readonly id: string;
  readonly name: string;
  readonly machine: CncMachineConfig;
};

export type CncLibrary = {
  readonly customTools: ReadonlyArray<CncTool>;
  readonly feedPresets: ReadonlyArray<CncFeedPreset>;
  readonly machineProfiles: ReadonlyArray<CncMachineProfile>;
};

export const EMPTY_CNC_LIBRARY: CncLibrary = {
  customTools: [],
  feedPresets: [],
  machineProfiles: [],
};

export function feedPresetFromSettings(
  id: string,
  name: string,
  settings: CncLayerSettings,
): CncFeedPreset {
  return {
    id,
    name,
    feedMmPerMin: settings.feedMmPerMin,
    plungeMmPerMin: settings.plungeMmPerMin,
    spindleRpm: settings.spindleRpm,
    depthPerPassMm: settings.depthPerPassMm,
    stepoverPercent: settings.stepoverPercent,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Returns false instead of throwing so a quota failure surfaces one warning
// without breaking the edit that triggered the write (material-library
// posture, M16).
export function persistCncLibrary(storage: StorageLike, library: CncLibrary): boolean {
  try {
    storage.setItem(CNC_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

// A corrupt slot is cleared so one bad write cannot re-fail every boot.
export function restoreCncLibrary(storage: StorageLike): CncLibrary | null {
  let raw: string | null;
  try {
    raw = storage.getItem(CNC_LIBRARY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = parseCncLibrary(raw);
  if (parsed === null) {
    try {
      storage.removeItem(CNC_LIBRARY_STORAGE_KEY);
    } catch {
      // Best-effort; restore already returned null.
    }
    return null;
  }
  return parsed;
}

export function parseCncLibrary(raw: string): CncLibrary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const customTools = arrayOf(record['customTools'], parseTool);
  const feedPresets = arrayOf(record['feedPresets'], parseFeedPreset);
  const machineProfiles = arrayOf(record['machineProfiles'], parseMachineProfile);
  return { customTools, feedPresets, machineProfiles };
}

function arrayOf<T>(raw: unknown, parse: (item: unknown) => T | null): ReadonlyArray<T> {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parse(item);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

const TOOL_KINDS: ReadonlyArray<CncToolKind> = ['end-mill', 'ball-nose', 'v-bit', 'engraving'];

function parseTool(raw: unknown): CncTool | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const kind = TOOL_KINDS.find((candidate) => candidate === record['kind']);
  if (
    typeof record['id'] !== 'string' ||
    typeof record['name'] !== 'string' ||
    kind === undefined ||
    !isPositive(record['diameterMm'])
  ) {
    return null;
  }
  const tipAngleDeg = record['tipAngleDeg'];
  return {
    id: record['id'],
    name: record['name'],
    kind,
    diameterMm: record['diameterMm'],
    ...(isPositive(tipAngleDeg) ? { tipAngleDeg } : {}),
  };
}

function parseFeedPreset(raw: unknown): CncFeedPreset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') return null;
  if (
    !isPositive(record['feedMmPerMin']) ||
    !isPositive(record['plungeMmPerMin']) ||
    !isPositive(record['spindleRpm']) ||
    !isPositive(record['depthPerPassMm']) ||
    !isPositive(record['stepoverPercent'])
  ) {
    return null;
  }
  return {
    id: record['id'],
    name: record['name'],
    feedMmPerMin: record['feedMmPerMin'],
    plungeMmPerMin: record['plungeMmPerMin'],
    spindleRpm: record['spindleRpm'],
    depthPerPassMm: record['depthPerPassMm'],
    stepoverPercent: record['stepoverPercent'],
  };
}

// Machine profiles reuse the .lf2 machine normalization contract loosely:
// structural sanity here, field-level clamping on apply (the config flows
// through updateCncMachine-style replacement).
function parseMachineProfile(raw: unknown): CncMachineProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const machine = record['machine'];
  if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') return null;
  if (typeof machine !== 'object' || machine === null) return null;
  const machineRecord = machine as Record<string, unknown>;
  if (machineRecord['kind'] !== 'cnc') return null;
  if (!Array.isArray(machineRecord['tools']) || typeof machineRecord['toolId'] !== 'string') {
    return null;
  }
  // Structure vetted above; deep field clamping happens on apply.
  return {
    id: record['id'],
    name: record['name'],
    machine: machine as CncMachineConfig,
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
