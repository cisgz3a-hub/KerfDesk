/**
 * T2-21: minimal property-based testing helper. Same execution shape
 * as fast-check (run a property over many random inputs, report the
 * first counterexample with its inputs) but in-house and dependency-
 * free. The audit's intent — broad random-input coverage of geometry
 * invariants — is preserved without adding `fast-check` to
 * `package.json`.
 *
 * Three primitives:
 *
 *   - `forAll(gens, predicate, opts?)`: run `predicate(...args)` over
 *     `opts.runs` (default 100) random samples drawn from the
 *     generators. The first failing case (predicate returned false or
 *     threw) is reported with its full input tuple plus a stable seed
 *     so the case is reproducible.
 *
 *   - `Arbitrary<T>`: a thin generator interface
 *     `{ sample(rng): T }`.
 *
 *   - A built-in `mulberry32`-style seeded PRNG so the same `seed`
 *     produces the same sequence — required so test failures are
 *     deterministic.
 *
 * Out of scope: fast-check's shrinker (auto-minimize counterexamples).
 * Tests still get the original failing input — minimization is a quality-
 * of-life feature; correctness is unaffected.
 *
 * Lives under `tests/helpers/` so the auto-discovery runner skips it.
 */

export interface Rng {
  next(): number;             // [0, 1)
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  bool(): boolean;
}

/** Deterministic PRNG (mulberry32). Seed → reproducible stream. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(min: number, max: number): number {
      // [min, max] inclusive
      return Math.floor(next() * (max - min + 1)) + min;
    },
    float(min: number, max: number): number {
      return next() * (max - min) + min;
    },
    bool(): boolean { return next() < 0.5; },
  };
}

export interface Arbitrary<T> {
  sample(rng: Rng): T;
}

export interface PropertyOptions {
  runs?: number;
  seed?: number;
}

/**
 * Run `predicate` over `runs` random tuples drawn from the supplied
 * generators. Returns `{ ok: true }` if every run passed; `{ ok: false,
 * input, error?, runIndex, seed }` for the first failing case.
 *
 * Variadic over up to 4 generators — extend if needed.
 */
export function forAll<A>(
  gen: [Arbitrary<A>],
  predicate: (a: A) => boolean,
  opts?: PropertyOptions,
): PropertyResult;
export function forAll<A, B>(
  gen: [Arbitrary<A>, Arbitrary<B>],
  predicate: (a: A, b: B) => boolean,
  opts?: PropertyOptions,
): PropertyResult;
export function forAll<A, B, C>(
  gen: [Arbitrary<A>, Arbitrary<B>, Arbitrary<C>],
  predicate: (a: A, b: B, c: C) => boolean,
  opts?: PropertyOptions,
): PropertyResult;
export function forAll(
  gens: Arbitrary<unknown>[],
  predicate: (...args: unknown[]) => boolean,
  opts?: PropertyOptions,
): PropertyResult {
  const runs = opts?.runs ?? 100;
  const seed = opts?.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const rng = makeRng(seed);
  for (let i = 0; i < runs; i++) {
    const args = gens.map((g) => g.sample(rng));
    let pass = false;
    let err: unknown = null;
    try {
      pass = predicate(...args);
    } catch (e) {
      err = e;
    }
    if (!pass) {
      return {
        ok: false,
        runIndex: i,
        seed,
        input: args,
        error: err instanceof Error ? err.message : err == null ? undefined : String(err),
      };
    }
  }
  return { ok: true, runs, seed };
}

export type PropertyResult =
  | { ok: true; runs: number; seed: number }
  | { ok: false; runIndex: number; seed: number; input: unknown[]; error?: string };

// ─── ARBITRARY GENERATORS ───────────────────────────────────────

/** Real number in [min, max], finite. */
export function realIn(min: number, max: number): Arbitrary<number> {
  return { sample(rng) { return rng.float(min, max); } };
}

export function intIn(min: number, max: number): Arbitrary<number> {
  return { sample(rng) { return rng.int(min, max); } };
}

export interface Pt { x: number; y: number }

/** Point with x ∈ [-bound, bound], y ∈ [-bound, bound]. */
export function point(bound: number): Arbitrary<Pt> {
  return {
    sample(rng) {
      return { x: rng.float(-bound, bound), y: rng.float(-bound, bound) };
    },
  };
}

/**
 * Convex polygon centered near origin: `n` points on a perturbed
 * radius around a random center. Always closed (last == first not
 * required by callers; our consumers iterate by index). Side count
 * in [3, maxN]; radius in (0.5, maxR].
 */
export function convexPolygon(maxN: number, maxR: number): Arbitrary<Pt[]> {
  return {
    sample(rng) {
      const n = rng.int(3, Math.max(3, maxN));
      const cx = rng.float(-50, 50);
      const cy = rng.float(-50, 50);
      const baseR = rng.float(0.5, maxR);
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        const r = baseR * (0.7 + rng.float(0, 0.6));
        pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      return pts;
    },
  };
}

/**
 * Affine transform: rotation in [-π, π], scale in [0.1, 5],
 * translation in [-100, 100]. Returns a `Matrix3x2`-shaped object
 * with `a/b/c/d/tx/ty` matching the codebase's convention.
 */
export interface AffineT { a: number; b: number; c: number; d: number; tx: number; ty: number }
export function affineTransform(): Arbitrary<AffineT> {
  return {
    sample(rng) {
      const angle = rng.float(-Math.PI, Math.PI);
      const sx = rng.float(0.1, 5);
      const sy = rng.float(0.1, 5);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        a: cos * sx,
        b: sin * sx,
        c: -sin * sy,
        d: cos * sy,
        tx: rng.float(-100, 100),
        ty: rng.float(-100, 100),
      };
    },
  };
}

export function applyAffine(p: Pt, t: AffineT): Pt {
  return {
    x: p.x * t.a + p.y * t.c + t.tx,
    y: p.x * t.b + p.y * t.d + t.ty,
  };
}

/** Bounding box of a point set. */
export interface AABB { minX: number; minY: number; maxX: number; maxY: number }
export function bounds(points: Pt[]): AABB {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Format a property failure for stable error output. */
export function describeFailure(r: Extract<PropertyResult, { ok: false }>): string {
  const head = `Property failed at run ${r.runIndex} (seed=${r.seed})`;
  const inp = r.input.map((v, i) => `  arg${i}: ${stringifyArg(v)}`).join('\n');
  const err = r.error ? `\n  error: ${r.error}` : '';
  return `${head}\n${inp}${err}`;
}

function stringifyArg(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (typeof val === 'number' && !Number.isFinite(val)) return String(val);
      return val;
    });
  } catch {
    return String(v);
  }
}
