/**
 * T2-73: formal migration pipeline. Pre-T2-73 the version stayed
 * at "0.1.0" hardcoded at `src/io/SceneSerializer.ts:27` while the
 * schema evolved through ad-hoc compatibility patches inside
 * deserialization functions (`_sourceText` → `sourceText` rename,
 * legacy grayscale buffer formats, etc.). Future loaders cannot
 * know what version of the schema they're looking at.
 *
 * Audit 4D Versioning weakness + Required Priority 7.
 *
 * T2-73 ships the framework — typed version discipline +
 * monotonic migration runner + warning capture — so future schema
 * bumps register a migration step instead of patching deserialize
 * branches. Wiring the existing ad-hoc legacy patches into formal
 * migration steps + the first 1-2 migrations is filed as
 * T2-73-followup.
 */

/**
 * Project-file version literal. Bump rules:
 *  - patch (1.0 → 1.0.1): no format change. Internal increment only.
 *  - minor (1.0 → 1.1): backward-compatible. Old loader can still
 *    read; new fields are optional.
 *  - major (1.x → 2.0): breaking. New loader required; old loader
 *    rejects.
 */
export type ProjectFileVersion =
  | '0.1.0'
  | '1.0'
  | '1.1'
  | '1.2';

export const CURRENT_PROJECT_VERSION: ProjectFileVersion = '1.2';

/** Strict ordered list — used for monotonic step computation. */
export const VERSION_ORDER: readonly ProjectFileVersion[] = [
  '0.1.0', '1.0', '1.1', '1.2',
] as const;

export interface MigrationStep {
  readonly from: ProjectFileVersion;
  readonly to: ProjectFileVersion;
  /** Pure transform: takes the raw envelope of `from`, returns `to`. */
  readonly migrate: (raw: unknown) => unknown;
  /** Optional human-readable warnings to surface to the user. */
  readonly warnings?: readonly string[];
  readonly notes: string;
}

export interface VersionedEnvelope {
  readonly version: ProjectFileVersion;
  /** The actual scene/document payload — opaque to the framework. */
  readonly payload: unknown;
}

export interface MigrationResult {
  readonly fromVersion: ProjectFileVersion;
  readonly toVersion: ProjectFileVersion;
  readonly migrationsApplied: readonly string[];
  readonly warnings: readonly string[];
  readonly final: VersionedEnvelope;
}

export class UnknownProjectVersionError extends Error {
  constructor(public readonly observed: unknown) {
    super(`Unknown project file version: ${String(observed)}`);
    this.name = 'UnknownProjectVersionError';
  }
}

export class MissingMigrationError extends Error {
  constructor(public readonly from: ProjectFileVersion, public readonly to: ProjectFileVersion) {
    super(`No migration registered for ${from} → ${to}`);
    this.name = 'MissingMigrationError';
  }
}

export class FutureVersionError extends Error {
  constructor(public readonly observed: ProjectFileVersion, public readonly current: ProjectFileVersion) {
    super(`Project file version ${observed} is newer than this app's max ${current}`);
    this.name = 'FutureVersionError';
  }
}

/** True if `a` strictly precedes `b` in the canonical version order. */
export function isVersionOlder(a: ProjectFileVersion, b: ProjectFileVersion): boolean {
  return VERSION_ORDER.indexOf(a) < VERSION_ORDER.indexOf(b);
}

export function isKnownVersion(v: unknown): v is ProjectFileVersion {
  return typeof v === 'string' && (VERSION_ORDER as readonly string[]).includes(v);
}

/**
 * Compute the ordered list of migration step keys to walk from
 * `from` → `to`. Pure helper for tests + the runner.
 */
export function plannedMigrationKeys(opts: {
  from: ProjectFileVersion;
  to: ProjectFileVersion;
}): string[] {
  if (opts.from === opts.to) return [];
  const fromIdx = VERSION_ORDER.indexOf(opts.from);
  const toIdx = VERSION_ORDER.indexOf(opts.to);
  if (fromIdx < 0 || toIdx < 0) return [];
  if (fromIdx > toIdx) return [];   // no down-migrations
  const out: string[] = [];
  for (let i = fromIdx; i < toIdx; i++) {
    out.push(`${VERSION_ORDER[i]}->${VERSION_ORDER[i + 1]}`);
  }
  return out;
}

/**
 * Migration registry — T2-73 ships the framework with NO migrations
 * registered. Each future schema bump adds a step here.
 */
export class MigrationRegistry {
  private readonly _steps = new Map<string, MigrationStep>();

  register(step: MigrationStep): void {
    const key = `${step.from}->${step.to}`;
    if (this._steps.has(key)) {
      throw new Error(`Migration ${key} already registered`);
    }
    this._steps.set(key, step);
  }

  get(from: ProjectFileVersion, to: ProjectFileVersion): MigrationStep | null {
    return this._steps.get(`${from}->${to}`) ?? null;
  }

  size(): number {
    return this._steps.size;
  }
}

/**
 * Run the migration pipeline. Walks the version chain step-by-step,
 * collecting warnings, until the envelope is at `target`. Throws
 * with a typed error class on:
 *  - unknown observed version
 *  - missing migration step
 *  - observed version newer than the target (future file)
 */
export function runMigrations(opts: {
  envelope: { version: unknown; payload: unknown };
  target: ProjectFileVersion;
  registry: MigrationRegistry;
}): MigrationResult {
  if (!isKnownVersion(opts.envelope.version)) {
    throw new UnknownProjectVersionError(opts.envelope.version);
  }
  if (isVersionOlder(opts.target, opts.envelope.version)) {
    throw new FutureVersionError(opts.envelope.version, opts.target);
  }
  const fromVersion = opts.envelope.version;
  const keys = plannedMigrationKeys({ from: fromVersion, to: opts.target });
  let cursor: VersionedEnvelope = {
    version: fromVersion,
    payload: opts.envelope.payload,
  };
  const applied: string[] = [];
  const warnings: string[] = [];
  for (const key of keys) {
    const [from, to] = key.split('->') as [ProjectFileVersion, ProjectFileVersion];
    const step = opts.registry.get(from, to);
    if (step == null) throw new MissingMigrationError(from, to);
    const nextPayload = step.migrate(cursor.payload);
    cursor = { version: to, payload: nextPayload };
    applied.push(key);
    if (step.warnings != null) warnings.push(...step.warnings);
  }
  return {
    fromVersion,
    toVersion: opts.target,
    migrationsApplied: applied,
    warnings,
    final: cursor,
  };
}

/** Predicate the load path consults: would loading this file run any migrations? */
export function fileNeedsMigration(opts: {
  fileVersion: ProjectFileVersion;
  current: ProjectFileVersion;
}): boolean {
  return isVersionOlder(opts.fileVersion, opts.current);
}

/** User-facing summary line for the migration result. */
export function describeMigrationResult(result: MigrationResult): string {
  if (result.migrationsApplied.length === 0) {
    return `Project at current version (${result.toVersion}); no migrations applied.`;
  }
  return (
    `Migrated project from ${result.fromVersion} → ${result.toVersion} ` +
    `(${result.migrationsApplied.length} step(s), ${result.warnings.length} warning(s)).`
  );
}
