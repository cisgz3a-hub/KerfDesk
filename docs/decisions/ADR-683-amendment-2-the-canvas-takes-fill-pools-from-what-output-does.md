## ADR-683 Amendment 2 - The canvas takes Fill pools from what output does: Output on, the compile run, and every operation a path burns under (2026-11-02)

**Status:** Accepted on 2026-11-02; unit-tested through the real store, `.lbrn` import, `drawScene`,
the compiler and `hitTest`. The `.lbrn` route was also opened in a desktop-mode dev build in Chromium,
which shows the filled ring. The other rows were not checked on screen, and nothing was
hardware-tested. |
**Amends:** ADR-683 decisions 1 and 2, and Amendment 1 items 1, 2 and 3 and its "Not changed" |
**With:** ADR-681 Amendment 1, which gives exports the same rule

### Context

Rolling audit v9 area R5 (`docs/audits/2026-11-02-rolling-v9/R5-fix-fill-canvas.md`,
refuter-confirmed by replaying `drawScene` in real Chromium against `compileJob`) found the pools
still disagreeing with the burn. The pool logic had regressed twice, because the canvas held its
own second copy of the compiler's grouping, and each fix patched that copy.

- **R5-P1-1 (P1, regression from Amendment 1).** Add operation on a plate's circle, then Output off
  on "Operation 2". The circle painted solid; the burn has a hole there. Amendment 1's "every
  visible Fill operation" counted one that burns nothing.
- **R5-P1-2 (P1, regression from ADR-683).** With two or more jig boxes each instance compiles in
  its own run (`registrationJigCompilationRuns`) and pools alone. The canvas pooled across runs, so
  an ordinary label on a jig copy showed as a hole, and that area burns twice.
- **R5-P1-3 (P1, older than ADR-683).** A shape bound Line then Fill stayed out of that Fill's pool,
  so a plate on it showed solid where the burn has the hole. A `.lbrn` Cut layer with a Scan
  sub-layer binds exactly this: outlines only on the canvas, a 4,000 mm hatched ring in the burn, no
  import warning. Amendment 1 recorded the stroke as KNOWN styling. It did not weigh this.
- **R5-P2-2 (P2).** In Wireframe a Fill plate's empty interior still took the click, so a Line square
  drawn before it could not be picked. ADR-410's outlines never reached the hit test.
- **R5-P3-1 (P3, regression from Amendment 1).** Amendment 1's scan of the artwork between pool
  members ran uncached every frame, quadratic for plates drawn apart from their windows.
- **R5-P3-2 (P3).** Amendment 1 says the clip budget is per frame; the code spent it per pool.

### Decision

1. **Membership is the compiler's rule, in one place** (`core/scene/fill-operations.ts`).
   `pathFillOperations` is built from the helpers the job itself uses: `outputOperationLayers`,
   `effectiveOperationForObject` and `pathUsesOperation`. Among a path's visible bound operations:
   - every one that burns it as Fill is one of its pools, in any binding position, so a Line binding
     no longer keeps it out;
   - an Output-off operation never counts while the path has an Output-on one: if none of the
     Output-on ones fills, the path has no pool and the job only cuts or engraves it;
   - a path with no output at all shows under its first operation, as what it would burn, which
     keeps the KNOWN "shown, not output" rule (a whole Output-off pool still shows its holes);
   - an enabled Fill sub-layer counts for its Line operation, so R5-P1-4 (latent, a hand-written file
     only) goes too. A Fill operation's own Fill sub-layer adds no second pool: its members are the same.
2. **A path is styled by the first bound operation that outputs**, else its first visible one
   (`pathStylingOperation`), as canvas, phone and hit test ask. An Output-off Fill first and an
   Output-on Line second therefore draws a stroke, which is what it burns.
3. **A pool stays inside its compile run** (`fillPoolRuns`). The job's gate moves to
   `separatelyCompiledJigInstances`, which `registrationJigCompilationRuns` and the pools both call,
   so they cannot drift. With one jig box there is one run, as in the job. The canvas, phone picture,
   `fillPoolParityAt` and the exports key pools by run.
4. **A Line-first path keeps its stroke and gets its fill.** `PathDisplay` carries `fillDisplay` and
   `fillRule` beside the stroke's display. Such a path, alone or not, is painted by its pool and
   stroked by its object. The phone's vector projection marks it filled. This retires the KNOWN
   "stroked only" line of Amendment 1 and the 2026-07-17 layers-panel parity line it cited.
5. **Clicks ask the same rule, and the view.** A path is solid where a Fill operation it burns under
   has odd parity. `hitTest` and `hitTestCandidates` take `wireframe`, under which no pool is painted,
   so every interior is an interior hit, as inside a Line shape (ADR-196): the artwork drawn inside
   is picked first, and an otherwise empty interior still selects the smallest shape around it.
   Every workspace click goes through `workspaceHitTest`, which reads the view. The jig editor has
   no Wireframe and keeps the plain test.
6. **The artwork between members is found by one sweep** (`drawnOverClusters`), so plates drawn apart
   from their windows stay near linear. It reads only the artwork lying in some cluster's gaps, and
   nothing at all when no cluster has one. It answers exactly what scanning each gap did (unit-tested
   against that scan).
7. **The clip budget is one per frame**, as Amendment 1 says. A split pool that would pass what is
   left of it is painted whole at its highest member.

### Consequences

- The canvas inks what `compileJob` burns, and no more than the named KNOWN rules. Those are still:
  Output-off artwork shows what it would burn; a hidden operation with Output on burns and shows
  nothing (2026-07-17 layers-panel parity).
- A `.lbrn` Cut + Scan layer now shows its hatched ring, and a project that relied on the canvas
  showing such a layer as outlines now shows its fill.
- Compiled output is byte-identical. Only one helper moved in the compiler, with the same behaviour.
- Measured in jsdom with a no-op context, one worker, on a machine under load, the audit's worst
  case at the project limit, 5,000 plates then 5,000 windows: `planFillPools` 65-88 ms (main
  1,910-2,347 ms), a still frame 193-262 ms (main 2,156-2,776 ms). The audit's unloaded figures for
  main were 424-462 ms and 54-61 ms before Amendment 1. No raster cost is included.
- **Not changed:**
  - Past the budget, the hit test still goes by object order while the pool is painted over the
    artwork between (the click half of R5-P3-2). The budget is met only by very dense split pools,
    the fallback is the trade Amendment 1 chose, and nothing that burns is hidden.
  - R5-P3-3 (a hover pulse floods one member alone) and R5-P3-4 (stacked Pocket copies on CNC, which
    the operator is told about).
  - The phone's vector projection still fills object by object (N6-P3-5), and Design Studio and trace
    parts keep the per-object test.

### Verification

`src/ui/workspace/draw-scene-burn-parity.test.ts` holds one table of scenes, compared point by point
on a 1 mm grid between `drawScene`'s fills (under their clips, photos opaque) and `compileJob`'s
hatch, with hit-test and Wireframe rows beside them. Rows use real Add operation, Output, Assign,
jig and `.lbrn` import actions where a route exists: Output off on each operation; hidden and
disabled; one and two jig boxes and overlapping boxes; Line then Fill and Fill then Line, alone and
on a plate; `.lbrn` Cut + Scan; plate and window in four drawing orders; text in Fill; photos
between members and above them. On the previous main 17 of its 56 cases fail, for R5-P1-1, R5-P1-2,
R5-P1-3, R5-P2-2 and the budget. The rest are controls that already held.
`fill-pool-clusters.test.ts` compares the sweep with the scan on random scenes. The compiler's own
suites pass unchanged, and SHA-256 hashes of `compileJob`'s output for all 31 table scenes (saved once,
then compiled by this code and by main's `registrationJigCompilationRuns`) are identical.
