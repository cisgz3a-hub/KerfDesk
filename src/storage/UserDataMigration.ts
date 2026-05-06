/**
 * T2-104: versioned user-data migration framework. Pre-T2-104
 * there was no framework: when LaserForge shipped an update that
 * changed any user-data schema (device profile fields, material
 * preset structure, autosave format, job log format, etc.), users
 * with existing data either lost it, saw it corrupted, or got the
 * current pattern of silent best-effort migration scattered across
 * each loader.
 *
 * Audit 5B Required Priority 12. Pairs with T2-73 (project-file
 * migrations) — T2-73 covers the on-disk `.laserforge.json`
 * scope; T2-104 covers the user-data scope (profiles / materials /
 * license cache / autosave / job logs / settings / replays /
 * correlation / history / other).
 *
 * T2-104 ships the per-domain registry + step runner + result
 * report. Per-loader call-site adoption is filed as
 * T2-104-followup.
 */

export type DataDomain =
  | 'device_profile'
  | 'material_preset'
  | 'license_cache'
  | 'autosave'
  | 'job_log'
  | 'settings'
  | 'replay'
  | 'correlation_state'
  | 'history'
  | 'other';

/** All known domains — used by the audit's "every domain has a registry" check. */
export const ALL_DATA_DOMAINS: readonly DataDomain[] = [
  'device_profile', 'material_preset', 'license_cache',
  'autosave', 'job_log', 'settings',
  'replay', 'correlation_state', 'history', 'other',
] as const;

/** A single migration step within a domain. fromVersion → toVersion. */
export interface DomainMigrationStep<T = unknown> {
  readonly domain: DataDomain;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly apply: (raw: unknown) => T;
  readonly notes?: string;
}

/** Per-domain migration result. */
export interface UserDataMigrationResult<T = unknown> {
  readonly domain: DataDomain;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly stepsApplied: readonly string[];
  readonly result: T;
}

export class MissingDomainMigrationError extends Error {
  constructor(
    public readonly domain: DataDomain,
    public readonly from: number,
    public readonly to: number,
  ) {
    super(`No migration registered for ${domain} v${from} → v${to}`);
    this.name = 'MissingDomainMigrationError';
  }
}

export class FutureUserDataVersionError extends Error {
  constructor(
    public readonly domain: DataDomain,
    public readonly observed: number,
    public readonly current: number,
  ) {
    super(
      `User data for ${domain} is at version ${observed}, ` +
      `newer than this app's max ${current}`,
    );
    this.name = 'FutureUserDataVersionError';
  }
}

/**
 * Reads a `version` field from raw user-data; defaults to 1 when
 * absent (audit's contract — pre-versioning data is treated as v1).
 */
export function detectUserDataVersion(raw: unknown): number {
  if (raw == null || typeof raw !== 'object') return 1;
  const v = (raw as Record<string, unknown>).version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return 1;
  return v;
}

/**
 * Per-domain migration registry. Each domain owns an ordered set
 * of steps. Steps must be a contiguous chain from v1 onwards —
 * registering a step whose `fromVersion` doesn't match the previous
 * step's `toVersion` throws.
 */
export class UserDataMigrationRegistry {
  private readonly _domains: Map<DataDomain, DomainMigrationStep<unknown>[]> = new Map();

  register(step: DomainMigrationStep<unknown>): void {
    if (step.fromVersion >= step.toVersion) {
      throw new Error(
        `Invalid step ${step.domain} v${step.fromVersion} → v${step.toVersion}: ` +
        `toVersion must be > fromVersion`,
      );
    }
    const existing = this._domains.get(step.domain) ?? [];
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      if (step.fromVersion !== last.toVersion) {
        throw new Error(
          `Non-contiguous step for ${step.domain}: ` +
          `last step ends at v${last.toVersion} but new step starts at v${step.fromVersion}`,
        );
      }
    } else if (step.fromVersion !== 1) {
      throw new Error(
        `First step for ${step.domain} must start at v1; got v${step.fromVersion}`,
      );
    }
    existing.push(step);
    this._domains.set(step.domain, existing);
  }

  stepsFor(domain: DataDomain): readonly DomainMigrationStep<unknown>[] {
    return this._domains.get(domain) ?? [];
  }

  /** True iff steps cover the whole chain from 1 → currentVersion. */
  isChainComplete(domain: DataDomain, currentVersion: number): boolean {
    if (currentVersion <= 1) return true;
    const steps = this.stepsFor(domain);
    if (steps.length !== currentVersion - 1) return false;
    return steps[steps.length - 1].toVersion === currentVersion;
  }

  size(): number {
    let total = 0;
    for (const steps of this._domains.values()) total += steps.length;
    return total;
  }

  domainsWithSteps(): readonly DataDomain[] {
    return Array.from(this._domains.keys());
  }
}

/**
 * Run the migration chain. Throws typed errors on missing-step or
 * future-version. Returns a typed result with the cast payload.
 */
export function migrateUserData<T>(opts: {
  domain: DataDomain;
  raw: unknown;
  currentVersion: number;
  registry: UserDataMigrationRegistry;
}): UserDataMigrationResult<T> {
  const observed = detectUserDataVersion(opts.raw);
  if (observed > opts.currentVersion) {
    throw new FutureUserDataVersionError(opts.domain, observed, opts.currentVersion);
  }
  const stepsApplied: string[] = [];
  let cursor: unknown = opts.raw;
  let cursorVersion = observed;
  while (cursorVersion < opts.currentVersion) {
    const steps = opts.registry.stepsFor(opts.domain);
    const step = steps.find((s) => s.fromVersion === cursorVersion);
    if (step == null) {
      throw new MissingDomainMigrationError(
        opts.domain, cursorVersion, cursorVersion + 1,
      );
    }
    cursor = step.apply(cursor);
    cursorVersion = step.toVersion;
    stepsApplied.push(`${opts.domain}:v${step.fromVersion}->v${step.toVersion}`);
  }
  return {
    domain: opts.domain,
    fromVersion: observed,
    toVersion: opts.currentVersion,
    stepsApplied,
    result: cursor as T,
  };
}

/** Predicate: would loading raw data run any migration? */
export function userDataNeedsMigration(opts: {
  raw: unknown;
  currentVersion: number;
}): boolean {
  return detectUserDataVersion(opts.raw) < opts.currentVersion;
}

/** User-facing summary line for the migration outcome. */
export function describeUserDataMigration(result: UserDataMigrationResult): string {
  if (result.stepsApplied.length === 0) {
    return `${result.domain}: at current version v${result.toVersion}; no migration applied.`;
  }
  return (
    `${result.domain}: migrated v${result.fromVersion} → v${result.toVersion} ` +
    `(${result.stepsApplied.length} step(s)).`
  );
}
