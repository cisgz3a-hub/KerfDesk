// Canonical Result for core control-flow errors (ADR-130). CLAUDE.md's "Pure
// core" section bans throwing for expected conditions; ops return this instead.
// The `kind` tag matches the house discriminated-union style, so a switch over
// a Result's variants can close its default arm with `assertNever`.

export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly error: E };

/** Wrap a success value. The `never` error slot unifies with any `Result<T, E>`. */
export function ok<T>(value: T): Result<T, never> {
  return { kind: 'ok', value };
}

/** Wrap a failure. The `never` value slot unifies with any `Result<T, E>`. */
export function err<E>(error: E): Result<never, E> {
  return { kind: 'error', error };
}
