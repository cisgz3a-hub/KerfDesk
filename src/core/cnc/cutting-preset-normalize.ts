import type {
  CncCuttingContext,
  CncCuttingMachineContext,
  CncCuttingPreset,
  CncCuttingProvenance,
  CncCuttingQualification,
  CncCuttingToolContext,
  CncCuttingValues,
} from '../scene/cnc-cutting-preset';
import { isValidCncTipAngleDeg } from '../cnc-tip-angle';

const TOOL_KINDS = ['end-mill', 'ball-nose', 'v-bit', 'engraving', 'tapered-ball-nose'] as const;
const SOURCE_KINDS = ['operator', 'calculator', 'manufacturer', 'imported'] as const;

/** Shared by app-library import and .lf2 operation snapshots. Invalid bindings are never unbound. */
export function normalizeCncCuttingPreset(raw: unknown): CncCuttingPreset | null {
  if (!record(raw)) return null;
  const id = text(raw['id'], 200);
  const name = text(raw['name'], 200);
  const values = cuttingValues(raw);
  if (id === null || name === null || values === null) return null;
  if (raw['units'] !== undefined && raw['units'] !== 'mm-min-rpm') return null;
  const context = normalizeCncCuttingContext(raw['context']);
  if (raw['context'] !== undefined && context === null) return null;
  const provenance = source(raw['provenance']);
  const recordedQualification = qualified(raw['qualification']);
  const qualification =
    context === null && recordedQualification?.status === 'operator-qualified'
      ? { ...recordedQualification, status: 'unverified' as const }
      : recordedQualification;
  return { id, name, ...values, ...presetMetadata(raw, context, provenance, qualification) };
}

export function normalizeCncCuttingContext(raw: unknown): CncCuttingContext | null {
  if (!record(raw)) return null;
  const tool = toolContext(raw['tool']);
  const machine = machineContext(raw['machine']);
  const materialKey = text(raw['materialKey'], 120);
  return tool === null || machine === null || materialKey === null
    ? null
    : { tool, machine, materialKey };
}

function cuttingValues(raw: Record<string, unknown>): CncCuttingValues | null {
  const feedMmPerMin = raw['feedMmPerMin'];
  const plungeMmPerMin = raw['plungeMmPerMin'];
  const spindleRpm = raw['spindleRpm'];
  const depthPerPassMm = raw['depthPerPassMm'];
  const stepoverPercent = raw['stepoverPercent'];
  if (
    !positive(feedMmPerMin) ||
    !positive(plungeMmPerMin) ||
    !positive(spindleRpm) ||
    !positive(depthPerPassMm) ||
    !positive(stepoverPercent) ||
    stepoverPercent > 100
  )
    return null;
  return { feedMmPerMin, plungeMmPerMin, spindleRpm, depthPerPassMm, stepoverPercent };
}

function toolContext(raw: unknown): CncCuttingToolContext | null {
  if (!record(raw)) return null;
  const id = text(raw['id'], 200);
  const name = text(raw['name'], 200);
  const kind = TOOL_KINDS.find((candidate) => candidate === raw['kind']);
  const diameterMm = raw['diameterMm'];
  if (id === null || name === null || kind === undefined || !positive(diameterMm)) return null;
  if (!validOptionalToolMetadata(raw)) return null;
  return { id, name, kind, diameterMm, ...toolMetadata(raw) };
}

function machineContext(raw: unknown): CncCuttingMachineContext | null {
  if (!record(raw)) return null;
  const name = text(raw['name'], 200);
  const controllerKind = text(raw['controllerKind'], 120);
  const spindleMaxRpm = raw['spindleMaxRpm'];
  const maxFeedMmPerMin = raw['maxFeedMmPerMin'];
  if (
    name === null ||
    controllerKind === null ||
    !positive(spindleMaxRpm) ||
    !positive(maxFeedMmPerMin)
  )
    return null;
  const profileId = text(raw['profileId'], 200);
  return {
    name,
    controllerKind,
    spindleMaxRpm,
    maxFeedMmPerMin,
    ...(profileId === null ? {} : { profileId }),
  };
}

function source(raw: unknown): CncCuttingProvenance | null {
  if (!record(raw)) return null;
  const kind = SOURCE_KINDS.find((candidate) => candidate === raw['kind']);
  const reference = text(raw['reference'], 3000, true);
  return kind === undefined || reference === null ? null : { kind, reference };
}

function qualified(raw: unknown): CncCuttingQualification | null {
  if (!record(raw)) return null;
  const status = raw['status'];
  const notes = text(raw['notes'], 3000, true);
  return (status !== 'unverified' && status !== 'operator-qualified') || notes === null
    ? null
    : { status, notes };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number, empty = false): string | null {
  return typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max
    ? value
    : null;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function presetMetadata(
  raw: Record<string, unknown>,
  context: CncCuttingContext | null,
  provenance: CncCuttingProvenance | null,
  qualification: CncCuttingQualification | null,
): Partial<CncCuttingPreset> {
  return {
    ...(raw['units'] === 'mm-min-rpm' ? { units: 'mm-min-rpm' as const } : {}),
    ...(context === null ? {} : { context }),
    ...(provenance === null ? {} : { provenance }),
    ...(qualification === null ? {} : { qualification }),
  };
}
function validOptionalToolMetadata(raw: Record<string, unknown>): boolean {
  return (
    optionalValid(raw['tipAngleDeg'], isValidCncTipAngleDeg) &&
    optionalValid(raw['tipDiameterMm'], (value) => finite(value) && value >= 0) &&
    optionalValid(raw['fluteCount'], (value) => positive(value) && Number.isInteger(value))
  );
}
function optionalValid(value: unknown, valid: (value: unknown) => boolean): boolean {
  return value === undefined || valid(value);
}
function toolMetadata(raw: Record<string, unknown>): Partial<CncCuttingToolContext> {
  const family = text(raw['family'], 120),
    tipAngleDeg = raw['tipAngleDeg'],
    tipDiameterMm = raw['tipDiameterMm'],
    fluteCount = raw['fluteCount'];
  return {
    ...(family === null ? {} : { family }),
    ...(isValidCncTipAngleDeg(tipAngleDeg) ? { tipAngleDeg } : {}),
    ...(finite(tipDiameterMm) ? { tipDiameterMm } : {}),
    ...(positive(fluteCount) ? { fluteCount } : {}),
  };
}
