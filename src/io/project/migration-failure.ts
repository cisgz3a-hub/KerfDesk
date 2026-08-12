const MIGRATION_FAILURE = Symbol('project-migration-failure');

/** Internal failure value that cannot collide with any JSON project property. */
export type MigrationFailure = {
  readonly [MIGRATION_FAILURE]: true;
  readonly reason: string;
};

export function migrationFailure(reason: string): MigrationFailure {
  return { [MIGRATION_FAILURE]: true, reason };
}

export function isMigrationFailure(value: unknown): value is MigrationFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[MIGRATION_FAILURE] === true
  );
}
