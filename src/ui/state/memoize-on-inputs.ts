// Zustand runs every mounted selector on every store set, and a streamed job
// sets the laser store about three times per acknowledged line. A selector that
// builds a string or an object must therefore not rebuild it while the fields it
// reads are unchanged: the caller lists exactly those fields, and the derivation
// reruns only when one of them changes identity.

export function memoizeOnInputs<S, R>(
  inputsOf: (source: S) => ReadonlyArray<unknown>,
  derive: (source: S) => R,
): (source: S) => R {
  let last: { readonly inputs: ReadonlyArray<unknown>; readonly result: R } | null = null;
  return (source) => {
    const inputs = inputsOf(source);
    if (last !== null && sameInputs(last.inputs, inputs)) return last.result;
    last = { inputs, result: derive(source) };
    return last.result;
  };
}

export function sameInputs(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}
