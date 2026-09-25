import type { TraceSettingsRecord, TraceSettingsValue } from '../../core/scene';
import { isObject } from './project-shape-primitives';

// ADR-400: recorded Trace dialog settings are Re-trace convenience metadata,
// never output-bearing. Like library provenance, a malformed, hostile or newer
// snapshot is dropped as a whole so it can never refuse a project load or reach
// the dialog half-valid; the trace itself loads unchanged and Re-trace opens on
// the defaults. Override keys are owned by the UI, so any well-formed key with
// a primitive value is kept (a newer build's controls survive an older save).
const MAX_OVERRIDE_ENTRIES = 64;
const MAX_TEXT_LENGTH = 128;
const OVERRIDE_KEY = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const OUTPUTS = ['vector', 'raster'] as const;
const FILL_STYLES = ['scanline', 'offset', 'island'] as const;
const BOUNDARY_MODES = ['crop', 'enhance'] as const;

type Boundary = NonNullable<TraceSettingsRecord['boundary']>;
type OptionalFields = Omit<TraceSettingsRecord, 'schemaVersion' | 'presetName' | 'overrides'>;

const TRACE_RESULT_KINDS: ReadonlyArray<unknown> = ['traced-image', 'raster-image'];

/** Keep a well-formed `traceSettings` only on trace results; drop it otherwise. */
export function withNormalizedTraceSettings(obj: Record<string, unknown>): Record<string, unknown> {
  if (!('traceSettings' in obj)) return obj;
  const traceSettings = TRACE_RESULT_KINDS.includes(obj['kind'])
    ? normalizeTraceSettingsRecord(obj['traceSettings'])
    : undefined;
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
    if (!OVERRIDE_KEY.test(key) || !isSettingsValue(entry)) return undefined;
    out[key] = entry;
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
