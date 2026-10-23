## ADR-153 Amendment 1 - The rest ladder reaches its target's middle above 50% stepover; stock-aware rest and its full-pocket fallback are recorded (2026-10-23)

**Status:** Accepted; software-verified through planner and independent G-code height-field
tests, hardware qualification pending. | **Date:** 2026-10-23

Amends ADR-153's finishing rings ("the larger-tool section runs first ... before the smaller rest
section"; the rest bit "machines only the modeled remainder") and its refusal rule ("No invalid
request falls back to a full-pocket cut with the small bit"). It fixes CNC audit v1 finding F2-P2-2
and records the stock-aware rest model, part of finding F2-P3-2
(`docs/audits/2026-10-23-cnc-v1/F2-cnc-pocket-adaptive.md`). Stock-aware rest shipped in the October
CNC leaders build (`docs/audits/2026-10-08-cnc-leaders/BUILD.md`, C10) without a decision of its own.
The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here
adds a guard, a refusal or a warning.

### Context

The rest ladder (`rest-pocket.ts`, `centerRegionRings`) insets the rest target, the region where the
finishing bit's centre must pass, by whole steps and stops at the first empty inset. The ordinary
pocket ladder had the same gap until July: audit item 1.10 gave it a core ring
(`pocket-paths.ts`, `coreRing` and `remainingPocketCores`), and that fix left the rest ladder out.

Above 50% stepover the last ring's sweep can stop short of the target's middle. A fin then stands to
full depth along every rest slot wider than the bit but narrower than two steps, and the ladder still
reports `complete`. Job Review says nothing.

The audit's case is a 40 mm square pocket, 3 mm deep, with an 8 mm arm the 9.525 mm rougher cannot
enter, finished with the 1/8" bit. The arm's rest target is a strip 4.825 mm wide. At 85% the second
inset is empty, so only the outline ring runs, and a 1.65 x 36 mm fin stands:

| Rest model | Stepover, arm | Uncut |
| --- | --- | --- |
| Legacy | 85%, 8 mm | 58.88 mm^2 |
| Stock-aware | 85%, 8 mm | 60.80 mm^2 |
| Legacy | 60%, 6.6 mm | 7.36 mm^2 |
| Legacy | 50% and 40%, 8 mm | 0 |
| Ordinary offset pocket (control) | 85%, 8 mm | 0 |

The stock-aware model (`cnc-rest-stock-operation.ts`, selected by Pocket → Rough first →
Previous-stock rest) works as follows:

- It predicts the residual from the rough stage's planned final-depth routes, with a conservative
  sweep tolerance, instead of the ideal cutter reach.
- It requires constant-Z offset or raster roughing, and a smaller flat finishing end mill at
  stepover no more than 100%.
- When its stock source is missing, invalid or unsupported, it cuts the whole pocket with the
  finishing bit as an ordinary offset pocket, with no M0, and Job Review says "Full offset-pocket
  fallback: <reason> No previous-stock subtraction is used."
- An adaptive layer that asks for previous-stock rest takes the same full-pocket fallback.

ADR-153 as written forbids such a fallback.

### Decision

1. **Core ring.** When the step is more than half the clearing width and the ladder ended by
   running out of interior, the rest ladder adds the ordinary pocket ladder's two cleanups:
   - each component of the rest target gets its deepest ring, found by the same bisection (24
     halvings, 0.01 mm);
   - any target left outside the sweep of every ring is cut along its outline.

   Both run before the ladder's own rings, innermost first, as in `pocketRingToolpaths`. At
   stepover of 50% or less, and after a geometry failure or the pass limit, the ladder is unchanged.
   A failure in the cleanup itself reports `geometry-failed`, which Job Review already surfaces.
2. **Both rest models** use this ladder: legacy rest (ideal rougher reach) and stock-aware rest
   (predicted residual).
3. **Stock-aware rest is recorded as built.** It is a second 2D stock model beside ADR-153's ideal
   reach. Its full-pocket fallback with the finishing bit is accepted for that model only, because it
   is executable output that cuts the pocket the operator drew, and Job Review discloses it. The
   legacy model keeps ADR-153's rule: an invalid request compiles no pocket for the layer, and
   preflight names the reason.
4. **Emitter revision** advances to `adaptive-island-strips-rest-cores-20261023-v27`, together
   with ADR-154 Amendment 4.

### Consequences

- The 8 mm arm at 85% and the 6.6 mm arm at 60% leave no reachable stock under either rest model.
- Rest output changes only for stepover above 50%. The field still accepts any positive stepover
  (AUD-100-014). The default of 40% is unchanged.
- The deepest ring adds one short pass per rest component above 50%, even where the outline ring
  already reached the middle. That matches the ordinary pocket and costs little time.
- Stock-aware rest still models stock in 2D from planned routes. It is not a measured or
  in-process stock simulation. Its tolerance band still re-traces walls conservatively, as the
  audit noted without raising it.

### Verification

- `compile-cnc-rest-core.test.ts` compiles and emits the two-tool program through the real compiler
  for four cases: the 8 mm arm at 85% and the 6.6 mm arm at 60%, each under legacy and stock-aware
  rest. An independent G-code parser and height field cuts each section at its own cutter radius
  (`program-height-field.test-support.ts`, 0.1 mm cells). It finds no reachable stock.
- Against main, the four cases fail: the legacy cases with the audit's 58.88 mm^2 and 7.36 mm^2.
- The existing rest, stock-aware and pocket-strategy tests pass unchanged. Among them, the 1% and
  200% stepovers keep their own ladders.
- No hardware run was made. ADR-153's hardware status stays CLAIMED.
