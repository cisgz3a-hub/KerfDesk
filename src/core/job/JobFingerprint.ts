/**
 * T2-85: explicit `JobFingerprint` type. Pre-T2-85
 * `ValidatedJobTicket` carried only `sceneHash + profileHash +
 * gcodeHash + controllerType` (4 fields). Audit 4F (Critical 2 +
 * Priority 3) calls out the gaps: a compiled job's result is also
 * a function of start mode, saved origin, machine capabilities, and
 * compile options. If any of those change between compile and
 * start, the job result is silently wrong but the partial-
 * fingerprint validation passes.
 *
 * T2-85 is the type definition + builder + comparison + reason
 * detection. The audit's full proposal threads `JobFingerprint`
 * through ValidatedJobTicket and the start path's mismatch detector;
 * that migration is filed as T2-85-followup since it touches the
 * existing `validateTicket` flow.
 */

import type { Scene } from '../scene/Scene';
import type { DeviceProfile } from '../devices/DeviceProfile';
import { hashSceneForPersistence } from '../../app/sceneDirtyHash';

export type StartMode = 'absolute' | 'current' | 'savedOrigin';

/**
 * The fields whose change invalidates a compile. Each is a hash or
 * stable enum so equality is `===` between fingerprints.
 */
export interface JobFingerprint {
  sceneHash: string;
  profileHash: string;
  materialHash: string;
  startMode: StartMode;
  savedOriginHash: string;
  machineCapabilitiesHash: string;
  compileOptionsHash: string;
}

/**
 * FNV-1a 32-bit hex of the JSON-stringified value (with key sorting
 * for stability). Same shape as the autosave checksum (T2-69) and
 * dirty-hash (T2-88) — corruption-strength only, not cryptographic.
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

export function hashObject(value: unknown): string {
  if (value == null) return 'none';
  return fnv1a32Hex(JSON.stringify(sortKeys(value)));
}

export interface BuildJobFingerprintArgs {
  scene: Scene;
  profile: DeviceProfile | null;
  materialSnapshot: unknown;
  startMode: StartMode;
  savedOrigin: { x: number; y: number } | null;
  capabilities: unknown;
  compileOptions: unknown;
}

export function buildJobFingerprint(args: BuildJobFingerprintArgs): JobFingerprint {
  return {
    sceneHash: hashSceneForPersistence(args.scene),
    profileHash: hashObject(args.profile),
    materialHash: hashObject(args.materialSnapshot),
    startMode: args.startMode,
    savedOriginHash: hashObject(args.savedOrigin),
    machineCapabilitiesHash: hashObject(args.capabilities),
    compileOptionsHash: hashObject(args.compileOptions),
  };
}

export function fingerprintsEqual(a: JobFingerprint, b: JobFingerprint): boolean {
  return (
    a.sceneHash === b.sceneHash &&
    a.profileHash === b.profileHash &&
    a.materialHash === b.materialHash &&
    a.startMode === b.startMode &&
    a.savedOriginHash === b.savedOriginHash &&
    a.machineCapabilitiesHash === b.machineCapabilitiesHash &&
    a.compileOptionsHash === b.compileOptionsHash
  );
}

/**
 * Returns a list of fields that differ between two fingerprints.
 * Empty array means equal. Useful for the audit's "specific reason
 * for ticket validation failure" surface (e.g. "startMode changed
 * since compile" vs "scene changed since compile" — different UX
 * messaging per field).
 */
export type JobFingerprintField = keyof JobFingerprint;

export function fingerprintDiff(a: JobFingerprint, b: JobFingerprint): JobFingerprintField[] {
  const fields: JobFingerprintField[] = [];
  for (const k of Object.keys(a) as JobFingerprintField[]) {
    if (a[k] !== b[k]) fields.push(k);
  }
  return fields;
}

/**
 * Render-ready summary of the first changed field for ticket-
 * validation failure messages. Returns null when fingerprints match.
 */
export function fingerprintMismatchReason(
  a: JobFingerprint,
  b: JobFingerprint,
): { field: JobFingerprintField; message: string } | null {
  const diff = fingerprintDiff(a, b);
  if (diff.length === 0) return null;
  const field = diff[0];
  const messages: Record<JobFingerprintField, string> = {
    sceneHash: 'The design changed after this G-code was compiled. Recompile to continue.',
    profileHash: 'The device profile changed after compile. Recompile to continue.',
    materialHash: 'A layer\'s material preset changed after compile. Recompile to continue.',
    startMode: 'The start mode changed after compile. Recompile to continue.',
    savedOriginHash: 'The saved origin changed after compile. Recompile to continue.',
    machineCapabilitiesHash: 'The machine capabilities changed after compile (e.g. firmware reported new $30). Recompile to continue.',
    compileOptionsHash: 'A compile option (e.g. optimize-order, engrave direction) changed after compile. Recompile to continue.',
  };
  return { field, message: messages[field] };
}
