/**
 * T2-109: reconstruction-grade JobLog. Pre-T2-109 JobLog stored ~17
 * fields — missing the app/system context, the active profile + $$
 * snapshot, the full T2-85 fingerprint, the T2-86 FrameState at start,
 * preflight blockers/warnings/confirmation flags, and the gcode hash
 * + excerpt. Audit 5C Critical failure 3 + Required Priority 3.
 *
 * T2-109 ships the EXTENSION shape — `JobLogReconstructionFields` —
 * plus a builder that assembles it from the per-subsystem snapshots
 * (T2-71 profile, T2-110 controller settings, T2-85 fingerprint, T2-86
 * frame state, T2-117 correlation IDs). Adopting this on the live
 * `JobLog` interface is filed as T2-109-followup since it requires
 * T2-104's (user-data migration) framework so old JobLogs without the
 * new fields stay readable.
 *
 * The shape is "additive": `JobLogReconstructionFields` is a separate
 * interface the followup attaches as `JobLog.reconstruction?` so
 * existing JobLog consumers keep working.
 */

import type { CorrelationIds } from '../../diagnostics/CorrelationIds';
import type { ControllerSettingsSnapshot } from '../../diagnostics/ControllerSettingsSnapshot';
import type { JobFingerprint } from './JobFingerprint';
import type { FrameState } from '../../app/FrameState';
import type { DeviceProfile } from '../devices/DeviceProfile';

// ─── per-axis blocks ───────────────────────────────────────

export interface AppContext {
  version: string;
  buildChannel?: 'stable' | 'beta' | 'alpha' | 'dev';
  platform: string;
  electronVersion?: string;
}

export interface MachineContext {
  controllerType: 'grbl' | 'marlin' | 'unknown' | string;
  connectionType: 'web-serial' | 'electron-serial' | 'simulator' | 'wifi' | string;
  profileId: string;
  profileSnapshot: DeviceProfile;
  firmware?: string;
  settings?: ControllerSettingsSnapshot;
}

export interface AABB {
  minX: number; minY: number; maxX: number; maxY: number;
}

export type StartMode = 'absolute' | 'current' | 'savedOrigin';

export interface GcodeExcerpt {
  first50: string[];
  last50: string[];
  hash: string;
}

export interface JobReconstructionContext {
  ticketId: string;
  fingerprint: JobFingerprint;
  gcodeLineCount: number;
  outputBounds: AABB;
  startMode: StartMode;
  savedOrigin: { x: number; y: number } | null;
  frameState: FrameState;
  gcodeExcerpt?: GcodeExcerpt;
}

export type PreflightIssueSeverity = 'blocker' | 'warning' | 'info';

export interface PreflightIssue {
  kind: string;
  severity: PreflightIssueSeverity;
  message: string;
  details?: unknown;
}

export interface PreflightContext {
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  /** True when user explicitly confirmed warnings before starting. */
  userConfirmedWarnings: boolean;
  /** Optional 0-100 readiness score for the post-job summary. */
  readinessScore?: number;
}

/**
 * The composite "extra fields" the followup will attach to JobLog
 * as `JobLog.reconstruction?`. Today it's a self-contained type the
 * support bundle (T2-108) and crash report can embed directly.
 */
export interface JobLogReconstructionFields {
  app: AppContext;
  machine: MachineContext;
  job: JobReconstructionContext;
  preflight: PreflightContext;
  /** T2-117 correlation snapshot at job start. */
  correlationIds: CorrelationIds;
}

// ─── builder ───────────────────────────────────────────────

/**
 * Hash a gcode string into a stable identifier. FNV-1a hex — same
 * shape as T2-85's hashObject for parity in the support bundle.
 */
export function hashGcodeText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (text.charCodeAt(i) >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Produce the gcode excerpt: first 50 + last 50 lines + hash.
 * The "support bundle pretty-printer never reads more than the
 * excerpt" rule lets us keep job logs lightweight even for
 * multi-thousand-line jobs.
 */
export function buildGcodeExcerpt(text: string): GcodeExcerpt {
  const lines = text.split(/\r?\n/);
  const first50 = lines.slice(0, 50);
  // last 50 — but if the file is < 100 lines, the excerpts overlap;
  // dedupe by taking from min(50, length) onwards.
  const lastStart = Math.max(0, Math.min(lines.length, 50), lines.length - 50);
  const last50 = lines.slice(lastStart);
  return { first50, last50, hash: hashGcodeText(text) };
}

export interface BuildReconstructionArgs {
  app: AppContext;
  machine: MachineContext;
  job: Omit<JobReconstructionContext, 'gcodeExcerpt'>;
  preflight: PreflightContext;
  correlationIds: CorrelationIds;
  /** When provided, builds a `gcodeExcerpt` automatically. */
  gcodeText?: string;
}

export function buildJobLogReconstruction(
  args: BuildReconstructionArgs,
): JobLogReconstructionFields {
  return {
    app: args.app,
    machine: args.machine,
    job: {
      ...args.job,
      gcodeExcerpt: args.gcodeText != null
        ? buildGcodeExcerpt(args.gcodeText) : undefined,
    },
    preflight: args.preflight,
    correlationIds: args.correlationIds,
  };
}

/**
 * Validation predicate the support bundle (T2-108) calls before
 * embedding. Returns the LIST of missing critical fields (empty
 * when valid) so a partial/early-job log can still serialise but
 * the bundle's manifest can flag what's incomplete.
 */
export function findMissingReconstructionFields(
  r: JobLogReconstructionFields,
): string[] {
  const missing: string[] = [];
  if (!r.app.version) missing.push('app.version');
  if (!r.machine.profileSnapshot) missing.push('machine.profileSnapshot');
  if (!r.machine.profileId) missing.push('machine.profileId');
  if (!r.job.ticketId) missing.push('job.ticketId');
  if (!r.job.fingerprint) missing.push('job.fingerprint');
  if (!r.correlationIds.sessionId) missing.push('correlationIds.sessionId');
  return missing;
}
