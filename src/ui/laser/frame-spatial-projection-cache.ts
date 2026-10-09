/** Keep one memoized scope per immutable source, even while Undo holds it alive. */
export function createLastScopeProjectionCache<Source extends object, Projection>(): {
  get(source: Source, scopeKey: string): Projection | undefined;
  set(source: Source, scopeKey: string, projection: Projection): void;
} {
  const entries = new WeakMap<Source, { scopeKey: string; projection: Projection }>();
  return {
    get(source, scopeKey) {
      const entry = entries.get(source);
      return entry?.scopeKey === scopeKey ? entry.projection : undefined;
    },
    set(source, scopeKey, projection) {
      entries.set(source, { scopeKey, projection });
    },
  };
}
