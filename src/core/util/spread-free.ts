// Loops for the three calls that used to spread an array into an argument list
// (performance audit S7-P2-3). `Math.min(...values)`, `Math.max(...values)` and
// `target.push(...items)` put every element on the call stack, so past about
// 120,000 elements the call throws "Maximum call stack size exceeded": text on
// a path or bent text in a script font failed from a few hundred characters.
//
// The results are the same as the spread calls for every input. The extrema
// fold through Math.min / Math.max, so NaN, -0 and the empty case (Infinity,
// -Infinity) behave exactly as before. `appendAll` reads the length first, so
// appending an array to itself copies it once, as the spread did.
// The kerfdesk/no-spread-math-extremum lint rule keeps the Math form out of src.

export function minOf(values: Iterable<number>): number {
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}

export function maxOf(values: Iterable<number>): number {
  let result = -Infinity;
  for (const value of values) result = Math.max(result, value);
  return result;
}

export function appendAll<T>(target: T[], items: ReadonlyArray<T>): void {
  const count = items.length;
  for (let index = 0; index < count; index += 1) target.push(items[index] as T);
}
