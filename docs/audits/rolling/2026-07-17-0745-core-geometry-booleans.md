# Rolling audit — core geometry (clipper boolean/offset seam)

- **When:** 2026-07-17 07:45 (+08)
- **Tree:** audit branch on `origin/main` @ `ed40b6d5` (rebased last iteration; verified unchanged upstream at audit time).
- **Scope:** `src/core/geometry/{vector-path-booleans,vector-path-tools,kerf-offset,point-in-polygon,dogbone}.ts` and the clipper2-ts call sites they own; cross-checked the `src/core/cnc` containment-test call sites the shared module's header names.
- **Method:** static read. **Not verified:** no property/fuzz run this iteration; LightBurn's exact weld/boolean semantics were NOT consulted against the reference — parity items below are framed as questions, not conclusions.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P3-1 — the point-in-polygon consolidation stalled and the copies have multiplied

[point-in-polygon.ts:1-4](../../src/core/geometry/point-in-polygon.ts) was extracted with a header saying it is "the third containment test in the tree — kerf-offset.ts and profile-ordering.ts still carry older local copies; migrating them is a separate tidy-first refactor." That migration never happened, and the population has since grown: local ray-cast copies now exist in **at least five** files — [kerf-offset.ts:94-106](../../src/core/geometry/kerf-offset.ts), [adaptive-pocket-verifier.ts:297](../../src/core/cnc/adaptive-pocket-verifier.ts), [compile-cnc-helpers.ts:51](../../src/core/cnc/compile-cnc-helpers.ts), [helical-entry.ts:261](../../src/core/cnc/helical-entry.ts), plus the profile-ordering copy the header names — while only `line-art-contours.ts` imports the shared module. Same algorithm each time, so today this is maintenance debt (CLAUDE.md "copy-paste duplication" anti-pattern), but each copy is a place a future edge-case fix (on-boundary probes, epsilon handling) won't land. In the same family: `kerf-offset.ts` re-implements `polylineToPathD` / `pathDToPolyline` / `pointsEqual` / `cleanCoord` that `vector-path-tools.ts` already exports ([kerf-offset.ts:49-114](../../src/core/geometry/kerf-offset.ts) vs [vector-path-tools.ts:213-276](../../src/core/geometry/vector-path-tools.ts)). A single tidy-first refactor PR clears the whole family.

---

## P3-2 — parity question: Weld unions per-color, never across colors

`weldVectorObjects` buckets contours by color and unions each bucket separately ([vector-path-tools.ts:97-121](../../src/core/geometry/vector-path-tools.ts)); welding a red shape overlapping a black shape yields two independent unions in one object, not one merged outline. **LightBurn's behavior was not verified this iteration** — if LightBurn's Weld merges all selected closed shapes into a single outline regardless of layer (the common text-on-badge workflow), ours diverges for cross-color selections. Rule 3 makes LightBurn the reference: this needs a maintainer check of the reference behavior before it's called a bug or a choice. (Boolean ops explicitly document their subject-color inheritance, so only Weld is in question.)

---

## P3-3 — parity/fidelity note: boolean, offset, and weld results are permanently flattened

All three op families return polyline-only objects ([vector-path-booleans.ts:62-74,106-117](../../src/core/geometry/vector-path-booleans.ts); [vector-path-tools.ts:113-134](../../src/core/geometry/vector-path-tools.ts)) — no `curves` are produced, so the save path backfills the curve channel as line segments. A boolean result of two smooth shapes is therefore frozen at import flatness (0.25 mm chords) for all downstream scaling/fairing, whereas LightBurn's booleans keep bezier geometry. Possibly a deliberate Phase A flatten-early pipeline decision — no ADR states it either way — but it interacts with the ADR-219 fairing investment: faired curves that pass through any boolean lose their curve channel.

---

## Verified clean (checked, no finding)

- **The old "unguarded clipper NaN exposure" thread (2026-07 CNC/Easel session) is CLOSED:** every `clipper2-ts` call in the audited files — union, difference, intersect, xor, inflate, dogbone's unions — runs inside `tryVectorOp`, which converts third-party throws into a typed `operation-failed` Result at the boundary ([vector-path-tools.ts:50-56](../../src/core/geometry/vector-path-tools.ts), ADR-131); the kerf path additionally degrades to the documented empty-contract on failure ([kerf-offset.ts:32-46](../../src/core/geometry/kerf-offset.ts), R6).
- **Pure-core discipline holds:** Results instead of throws, no console, and the boundary-catch is explicitly justified as third-party containment, not control flow.
- **NaN cannot poison bounds silently:** a NaN coordinate propagates into `minX`, fails `Number.isFinite`, and `boundsForPaths` returns null with a fallback to the subject's bounds ([vector-path-tools.ts:243-260](../../src/core/geometry/vector-path-tools.ts)).
- **`-0` is scrubbed** (`cleanCoord`) so results serialize deterministically.
- **Hole orientation is normalized by containment depth before inflate** ([kerf-offset.ts:74-92](../../src/core/geometry/kerf-offset.ts)) — mixed-orientation input can't flip an offset inside-out.
- **Weld refuses metadata-incompatible selections** (powerScale/lock/override) instead of silently merging them; empty and collapsed results surface typed, user-worded errors (WORKFLOW F-CNC22 states).
- **Offset validates its distance** (finite, ≥ 0.001 mm) before touching clipper.

## Not verified

- No fuzz/property exercise of the clipper seam this iteration (the guards were verified by reading, not by hostile inputs).
- LightBurn reference behavior for cross-color Weld and curve-preserving booleans (P3-2/P3-3) — flagged for the maintainer precisely because it was not checked.
