import { Sha256State } from '../../core/relief/sha256';

const HASH_CHARS = 32 * 1024;
const STRING_CHARS = 2048;

/** Lazily derived arrays avoid copying all polyline points into curve segments. */
export class RecoveryArray {
  constructor(readonly values: Iterable<unknown>) {}
}

/** The same JSON bytes as the previous recovery key, without a whole-document
 * string or UTF-8 copy. Each slice yields to input/paint before continuing. */
export function hashRecoveryIdentity(value: unknown): Promise<string> {
  return new RecoveryHash(value).result;
}

export class RecoveryHash {
  readonly result: Promise<string>;
  private readonly slices: Generator<void, string>;
  private resolve!: (digest: string) => void;
  private reject!: (error: unknown) => void;
  private timer: ReturnType<typeof setTimeout>;
  private digest: string | undefined;
  private failed = false;
  private error: unknown;

  constructor(value: unknown) {
    this.slices = hashSlices(value);
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.timer = setTimeout(() => this.runSlice(), 0);
  }

  /** Only document teardown may finish pending work without further task turns.
   * Reuse the same iterator/state: no duplicate hashing or full JSON allocation. */
  finishAtTeardown(): string {
    clearTimeout(this.timer);
    if (this.failed) throw this.error;
    try {
      while (this.digest === undefined) this.step();
    } catch (error) {
      this.fail(error);
      throw error;
    }
    return this.digest;
  }

  cancel(): void {
    if (this.digest !== undefined || this.failed) return;
    clearTimeout(this.timer);
    this.slices.return('');
    this.fail(new Error('The recovery project changed.'));
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.error = error;
    this.reject(error);
  }

  private step(): void {
    const next = this.slices.next();
    if (!next.done) return;
    this.digest = next.value;
    this.resolve(next.value);
  }

  private runSlice(): void {
    try {
      this.step();
      if (this.digest === undefined) this.timer = setTimeout(() => this.runSlice(), 0);
    } catch (error) {
      this.fail(error);
    }
  }
}

function* hashSlices(value: unknown): Generator<void, string> {
  const state = new Sha256State();
  const encoder = new TextEncoder();
  let chunks: string[] = [];
  let size = 0;
  for (const fragment of jsonFragments(value)) {
    chunks.push(fragment);
    size += fragment.length;
    if (size < HASH_CHARS) continue;
    state.update(encoder.encode(chunks.join('')));
    chunks = [];
    size = 0;
    yield;
  }
  state.update(encoder.encode(chunks.join('')));
  return `sha256:${state.finishHex()}`;
}

function* jsonFragments(value: unknown): Generator<string> {
  if (typeof value === 'string') yield* stringFragments(value);
  else if (value instanceof RecoveryArray) yield* arrayFragments(value.values);
  else if (Array.isArray(value)) yield* arrayFragments(value);
  else if (value !== null && typeof value === 'object') yield* objectFragments(value);
  else yield JSON.stringify(value) ?? 'null';
}

function* arrayFragments(values: Iterable<unknown>): Generator<string> {
  yield '[';
  let first = true;
  for (const value of values) {
    if (!first) yield ',';
    first = false;
    yield* jsonFragments(value);
  }
  yield ']';
}

function* objectFragments(value: object): Generator<string> {
  yield '{';
  let first = true;
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    if (!first) yield ',';
    first = false;
    yield* stringFragments(key);
    yield ':';
    yield* jsonFragments(child);
  }
  yield '}';
}

function* stringFragments(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length; ) {
    let end = Math.min(start + STRING_CHARS, value.length);
    // A surrogate pair must be encoded together, even across a slice boundary.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end++;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}
