/**
 * T1-119: production migration registry + envelope-migration helper.
 *
 * Pre-T1-119 the `runMigrations` runner in `MigrationPipeline.ts` was
 * exercised only by `tests/migration-pipeline.test.ts` — no production
 * load path imported it. Per the audit's Phase 2 #5 finding the
 * pipeline existed but `SceneSerializer.parseSceneEnvelope` short-
 * circuited straight from "envelope parsed" to "build scene" without
 * ever invoking the migration runner. T2-73's framework comment said
 * "Wiring the existing ad-hoc legacy patches into formal migration
 * steps + the first 1-2 migrations is filed as T2-73-followup." This
 * is that follow-up — the wiring half. Even with zero registered
 * migrations, having the pipeline in the live load path means:
 *  - future schema bumps register a step here and the loader
 *    automatically walks the chain;
 *  - unknown-future-version files get a typed FutureVersionError;
 *  - the existing ad-hoc geometry patches in `migrateGeometry` (e.g.
 *    `_sourceText` → `sourceText`) can move to formal migrations
 *    over time without changing the load contract.
 *
 * Version normalization: real-world project files carry tags like
 * `'1.0.0'`, `'1'`, `'1.1.0'`, even no version at all (legacy 0.1.x
 * dumps). The MigrationPipeline's `isKnownVersion` only accepts the
 * canonical `ProjectFileVersion` literals. We coerce the file's
 * version to the closest known canonical literal before calling
 * `runMigrations`. Anything we can't map is left to the pre-existing
 * forgiving load path (the migration helper returns the envelope
 * unchanged with a warning).
 */
import {
  CURRENT_PROJECT_VERSION,
  MigrationRegistry,
  type ProjectFileVersion,
  type MigrationResult,
  runMigrations,
  VERSION_ORDER,
} from './MigrationPipeline';

let _projectMigrationRegistry: MigrationRegistry | null = null;

/**
 * Lazily-initialized singleton. T2-73 ships the framework with NO
 * migrations registered; future schema bumps add `register()` calls
 * here. We use a singleton so a single load path can't race with
 * a concurrent call from another caller (e.g. autosave recover) and
 * see a half-populated registry.
 */
export function getProjectMigrationRegistry(): MigrationRegistry {
  if (_projectMigrationRegistry == null) {
    _projectMigrationRegistry = new MigrationRegistry();
    // T1-119: register no-op steps for the existing minor-version
    // chain. Per the ProjectFileVersion bump-rule contract, every
    // 1.x → 1.y transition is backward-compatible (new fields are
    // optional; old loader can still read). The pre-T1-119 load path
    // already accepted any 1.x file without a migration step because
    // it skipped the pipeline entirely; preserving that with explicit
    // no-op steps keeps the audit's "every old file goes through the
    // pipeline" contract while not breaking real fixtures stored at
    // 1.0 / 1.1. The 0.1.0 → 1.0 step is also backward-compatible
    // (the version-bump from 0.1.0 to 1.0 was just a header rename).
    // Schema-breaking migrations register a non-trivial migrate fn
    // here when they ship.
    _projectMigrationRegistry.register({
      from: '0.1.0',
      to: '1.0',
      notes: 'T1-119: no-op — 0.1.0 → 1.0 was a header-only version-string bump.',
      migrate: (raw) => raw,
    });
    _projectMigrationRegistry.register({
      from: '1.0',
      to: '1.1',
      notes: 'T1-119: no-op — 1.0 → 1.1 is a backward-compatible minor bump per the version contract.',
      migrate: (raw) => raw,
    });
    _projectMigrationRegistry.register({
      from: '1.1',
      to: '1.2',
      notes: 'T1-119: no-op — 1.1 → 1.2 is a backward-compatible minor bump per the version contract.',
      migrate: (raw) => raw,
    });
  }
  return _projectMigrationRegistry;
}

/** Test-only hook: reset the singleton between cases. */
export function _resetProjectMigrationRegistryForTest(): void {
  _projectMigrationRegistry = null;
}

export interface NormalizedEnvelopeVersion {
  /** Raw version literal as it appeared in the file (or null if missing). */
  readonly raw: string | null;
  /** Canonical ProjectFileVersion the runner can accept, or null when unmappable. */
  readonly canonical: ProjectFileVersion | null;
}

/**
 * Coerce a raw `version` string (or null) into a canonical
 * `ProjectFileVersion` the runner accepts.
 *
 * Rules:
 *  - missing / empty / `'0.1.0'`: legacy file, mapped to `'0.1.0'`
 *    (the earliest entry in `VERSION_ORDER`).
 *  - exact `'1.0'` / `'1.1'` / `'1.2'`: passes through unchanged.
 *  - `'1.0.x'` / `'1'` / `'1.0.0'`: normalized to `'1.0'`. Same idea
 *    for `'1.1.x'` → `'1.1'` and `'1.2.x'` → `'1.2'`.
 *  - `'1.x'` where x is a future minor (e.g. `'1.5'`): canonical=null.
 *    The forgiving load path in SceneSerializer logs the warning and
 *    proceeds without migration.
 *  - any non-1.x major: canonical=null. The major-version reject in
 *    `parseSceneEnvelope` already fires before this is consulted.
 */
export function normalizeProjectVersion(raw: unknown): NormalizedEnvelopeVersion {
  const rawStr = raw == null || raw === '' ? null : String(raw).trim();

  if (rawStr === null) {
    return { raw: null, canonical: '0.1.0' };
  }

  if ((VERSION_ORDER as readonly string[]).includes(rawStr)) {
    return { raw: rawStr, canonical: rawStr as ProjectFileVersion };
  }

  // Major.minor.patch → match on major+minor.
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(rawStr);
  if (match) {
    const candidate = `${match[1]}.${match[2]}` as ProjectFileVersion;
    if ((VERSION_ORDER as readonly string[]).includes(candidate)) {
      return { raw: rawStr, canonical: candidate };
    }
  }

  // Major-only (e.g. `'1'`) → assume earliest 1.x.
  const majorOnly = /^(\d+)$/.exec(rawStr);
  if (majorOnly && majorOnly[1] === '1') {
    return { raw: rawStr, canonical: '1.0' };
  }

  return { raw: rawStr, canonical: null };
}

export interface MigratedEnvelope {
  /** Envelope after migration. Identical to input when no migrations ran. */
  readonly envelope: { version: string; payload: unknown; [k: string]: unknown };
  /** Human-readable warnings collected by the runner (and one for unmapped versions). */
  readonly warnings: readonly string[];
  /** Migration result if a chain was walked; null when skipped. */
  readonly result: MigrationResult | null;
}

/**
 * Run the migration pipeline against a parsed scene envelope, with
 * the version-normalization fallback above. Idempotent on current-
 * version files (returns the envelope unchanged with no warnings).
 *
 * The envelope shape here is the loose `parsed` object that
 * SceneSerializer produces — it has the LaserForge file shape
 * (`format`, `version`, `scene`, etc.) but the migration runner only
 * cares about `version` and `payload`. We pass the WHOLE envelope as
 * the payload so step migrators can mutate any field they need; the
 * envelope's `version` field is rewritten by this helper to the
 * post-migration value so downstream `parseSceneEnvelope` checks see
 * a consistent state.
 */
export function migrateSceneEnvelope(
  parsedEnvelope: { version?: unknown; [k: string]: unknown },
): MigratedEnvelope {
  const normalized = normalizeProjectVersion(parsedEnvelope.version);
  const warnings: string[] = [];

  if (normalized.canonical == null) {
    warnings.push(
      `[LaserForge] Project file version '${normalized.raw ?? '(missing)'}' is not in `
      + `the migration registry's known set (${VERSION_ORDER.join(', ')}); `
      + `loading best-effort without migration.`,
    );
    return {
      envelope: parsedEnvelope as { version: string; payload: unknown; [k: string]: unknown },
      warnings,
      result: null,
    };
  }

  if (normalized.canonical === CURRENT_PROJECT_VERSION) {
    return {
      envelope: parsedEnvelope as { version: string; payload: unknown; [k: string]: unknown },
      warnings,
      result: null,
    };
  }

  const result = runMigrations({
    envelope: { version: normalized.canonical, payload: parsedEnvelope },
    target: CURRENT_PROJECT_VERSION,
    registry: getProjectMigrationRegistry(),
  });

  warnings.push(...result.warnings);

  // The migration runner produces a new payload object after each
  // step; we splice the post-migration version back in so downstream
  // consumers (e.g. `fileFormatMinor` checks) see the migrated value.
  const finalPayload = result.final.payload as { [k: string]: unknown };
  return {
    envelope: {
      ...finalPayload,
      version: result.final.version,
    } as { version: string; payload: unknown; [k: string]: unknown },
    warnings,
    result,
  };
}
