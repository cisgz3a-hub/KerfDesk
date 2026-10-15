// Worker transport reconstructs equal geometry in a different property order.
// Preserve values and array order while making object layout irrelevant to the
// retained execution identity. Reuse unchanged subtrees, so native stringify
// handles the dense coordinate arrays without a JS callback for every field.
// Projects are immutable (the retention key itself is cached by that contract).
// Geometry arrays are shared across edits, so normalize each array only once.
const orderedArrays = new WeakMap<ReadonlyArray<unknown>, ReadonlyArray<unknown>>();

export function orderedRetentionValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return orderedArray(value);
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (isOrderedPoint(fields, keys)) return value;
  const ordered = keys.every((key, index) => index === 0 || (keys[index - 1] ?? '') <= key);
  let changed: Record<string, unknown> | undefined = ordered
    ? undefined
    : (Object.create(null) as Record<string, unknown>);
  for (const key of ordered ? keys : keys.sort()) {
    const next = orderedRetentionValue(fields[key]);
    if (next !== fields[key] || changed !== undefined) {
      changed ??= { ...fields };
      Object.defineProperty(changed, key, {
        value: next,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return changed ?? value;
}

function isOrderedPoint(fields: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  return (
    keys.length === 2 &&
    keys[0] === 'x' &&
    keys[1] === 'y' &&
    typeof fields['x'] === 'number' &&
    typeof fields['y'] === 'number'
  );
}

function orderedArray(value: ReadonlyArray<unknown>): ReadonlyArray<unknown> {
  const cached = orderedArrays.get(value);
  if (cached !== undefined) return cached;
  let changed: unknown[] | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const next = orderedRetentionValue(value[index]);
    if (next !== value[index]) {
      changed ??= value.slice();
      changed[index] = next;
    }
  }
  const ordered = changed ?? value;
  orderedArrays.set(value, ordered);
  return ordered;
}
