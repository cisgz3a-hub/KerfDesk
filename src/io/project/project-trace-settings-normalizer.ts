import type { TraceSettingsRecord, TraceSettingsValue } from '../../core/scene/scene-object';
import { isObject } from './project-shape-primitives';

// ADR-408: recorded Trace dialog settings are Re-trace convenience metadata,
// never output-bearing. Like library provenance, a structurally malformed,
// hostile or newer (`schemaVersion` other than 1) record is dropped as a whole
// so it can never refuse a project load; the trace itself loads unchanged and
// Re-trace opens on the defaults. Override keys are owned by the UI: a single
// bad override entry is dropped on its own, and any well-formed key with a
// primitive value is kept, so a newer build's controls survive a save by this
// one. Unknown top-level record fields are not kept.
const MAX_OVERRIDE_ENTRIES = 64;
const MAX_TEXT_LENGTH = 128;
const OVERRIDE_KEY = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

// Exhaustive by construction: a value added to the record's type must be added
// here too, or a record using it would be dropped whole on load.
const OUTPUTS = literals({ vector: true, raster: true } satisfies Record<
  NonNullable<TraceSettingsRecord['output']>,
  true
>);
const FILL_STYLES = literals({ scanline: true, offset: true, island: true } satisfies Record<
  NonNullable<TraceSettingsRecord['fillStyle']>,
  true
>);
const BOUNDARY_MODES = literals({ crop: true, enhance: true } satisfies Record<
  NonNullable<TraceSettingsRecord['boundaryMode']>,
  true
>);

type Boundary = NonNullable<TraceSettingsRecord['boundary']>;
type OptionalFields = Omit<TraceSettingsRecord, 'schemaVersion' | 'presetName' | 'overrides'>;

/**
 * Keep a well-formed `traceSettings` on any scene object and drop a malformed
 * one. The record is inert metadata that only Re-trace reads (on a traced or
 * rasterized trace result), so it is not stripped from other kinds: an object
 * rebuilt from a trace under another kind must stay saveable under the ADR-204
 * drift check.
 */
export function withNormalizedTraceSettings(obj: Record<string, unknown>): Record<string, unknown> {
  if (!('traceSettings' in obj)) return obj;
  const traceSettings = normalizeTraceSettingsRecord(obj['traceSettings']);
  // Rebuild in place so a clean save stays byte-identical to its source.
  return Object.fromEntries(
    Object.entries(obj).flatMap(([key, value]) => {
      if (key !== 'traceSettings') return [[key, value]];
      return traceSettings === undefined ? [] : [[key, traceSettings]];
    }),
  );
}

export function normalizeTraceSettingsRecord(value: unknown): TraceSettingsRecord | undefined {
  if (!isObject(value) || value['schemaVersion'] !== 1) return undefined;
  const presetName = value['presetName'];
  if (!isBoundedText(presetName) || presetName.trim() === '') return undefined;
  const overrides = normalizeOverrides(value['overrides']);
  if (overrides === undefined) return undefined;
  const optional = optionalFields(value);
  if (optional === undefined) return undefined;
  return { schemaVersion: 1, presetName, overrides, ...optional };
}

function normalizeOverrides(
  value: unknown,
): Readonly<Record<string, TraceSettingsValue>> | undefined {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_OVERRIDE_ENTRIES) return undefined;
  const out: Record<string, TraceSettingsValue> = {};
  for (const [key, entry] of entries) {
    // One bad entry costs only itself; the dialog re-filters by type anyway.
    if (OVERRIDE_KEY.test(key) && isSettingsValue(entry)) out[key] = entry;
  }
  return out;
}

function optionalFields(value: Record<string, unknown>): OptionalFields | undefined {
  const output = optionalLiteral(value['output'], OUTPUTS);
  const fillStyle = optionalLiteral(value['fillStyle'], FILL_STYLES);
  const boundaryMode = optionalLiteral(value['boundaryMode'], BOUNDARY_MODES);
  const boundary = optionalBoundary(value['boundary']);
  if (output === null || fillStyle === null || boundaryMode === null || boundary === null) {
    return undefined;
  }
  return {
    ...(output === undefined ? {} : { output }),
    ...(fillStyle === undefined ? {} : { fillStyle }),
    ...(boundary === undefined ? {} : { boundary }),
    ...(boundaryMode === undefined ? {} : { boundaryMode }),
  };
}

/** `undefined` when absent, `null` when present but invalid. */
function optionalLiteral<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
): T | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : null;
}

/** `undefined` when absent, `null` when present but invalid. */
function optionalBoundary(value: unknown): Boundary | undefined | null {
  if (value === undefined) return undefined;
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  if (!isNonNegativeFinite(x) || !isNonNegativeFinite(y)) return null;
  if (!isNonNegativeFinite(width) || !isNonNegativeFinite(height)) return null;
  if (width === 0 || height === 0) return null;
  return { x, y, width, height };
}

function isSettingsValue(value: unknown): value is TraceSettingsValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return isBoundedText(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function literals<T extends string>(map: Readonly<Record<T, unknown>>): ReadonlyArray<T> {
  return Object.keys(map) as T[];
}
