# Rolling audit v9 — R6 Studio, A1 Pro bed and harness fixes (#1521, #1520, #1525)

- **When:** 2026-11-02 +0800   **Tree:** origin/main @ `54e0e19b8` (`git fetch origin main` unchanged at the end).
  - Merge commits: #1521 `5b4c82caa`, #1520 `696496c8a`, #1525 `6836fe10a`. Desktop 1.0.28 is `33bc394c6`.
  - **Repros ran on main's tree, not the worktree,** in `…\scratchpad\j7-main\`. The 16 source files this report cites most were hash-checked against `origin/main`: all match.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-r6-vitest.config.ts --silent=false --disableConsoleIntercept`.
  - **Older code:** `git archive` exports of `33bc394c6`, `5b4c82caa^1` and `696496c8a^1`, kept outside `j7-main`. `R6_TREE` serves them in place of main's files through a Vite plugin. `R6_ONLY` limits that to the files a PR changed.
- **Scope:** fix verification and siblings of:
  - #1521: ADR-590 Amd 2 and ADR-573 Amd 2. Findings fixed: v8 N5-P2-2 (P1 after its refuter) and N5-P2-1.
  - #1520: ADR-637 Amd 4. Findings fixed: v8 N2-P2-1 and N2-P3-5.
  - #1525: v8 N7-P3-2.
- **Lenses run:**
  - **L10:** all five steps for the three PRs.
  - **L9:** Studio open routes (restore, decline, no autosave, New, Open with and without a Studio drawing), toolbar W/H with lock off, group resize, part resize, Move laser here, Frame, Absolute preflight, Machine Setup comparison.
  - **L11:** a Studio project and slot, and an accepted 363 × 273 profile, each saved by the real 1.0.28 code and opened on main.
  - **L2:** grblHAL `machine_limits.c` @ `f8f10aec`, re-fetched.
  - Not run: a real pointer, the packaged app, any release workflow, hardware.
- **Counts:** 11 raised → 0 refuted → P1 2 / P2 3 / P3 6 (+ 4 KNOWN re-observed). Refuter: 10 CONFIRMED, 1 PLAUSIBLE (R6-P3-5, code reading only), 0 REFUTED, no severity changes. Main was still `54e0e19b8` when the refuter finished.

## Headline

**All three PRs fix the path each one names. #1521 also brought a regression, and its rule still loses a drawing on other routes. So #1521 does not fully hold; #1520 holds on the preset; #1525 holds as far as it can be checked unrun.**

- **#1521, drawing kept:** the 3-line drawing is offered back on restore and on decline. Restore then Apply gives 3 objects. Two Applies, Apply then edits, and a crash with no autosave all work.
- **#1521, W then H:** 120 × 60 after Apply; 0 of 32 sub-mm cases read as stretched.
- **#1520:** the published dump offers no bed row and still offers acceleration. Travel fact is plain, jog and click stop at 0..358 × 0..268, stock GRBL and FluidNC are unchanged.
- **#1525:** the exit code is recorded before the throw in all three phases. Parse-checks are clean, and evidence cannot fail a healthy run. **No release run has exercised it** (every run since is `skipped`).

**What remains:**

- **R6-P1-1 (sibling gap).** An applied drawing is still written over, silently, when the opened project shares no shape and no operation with it. Three routes: redraw on another layer, Apply empty then redraw, or open another Studio project first after the crash.
- **R6-P1-2 (regression from #1521).** Applied drawings now fill the five kept slots, and each File > New with the Studio opened adds one. In the repro five of them evict a real unapplied drawing, with no notice. The parent keeps it.
- **R6-P2-1 (regression from #1521).** New, an ordinary restart, or opening a project with no Studio drawing now offers the previous project's fully saved drawing, until it is discarded or its file is opened in the Studio.
- **R6-P2-2 (gap in #1521).** The tolerance is far below what the toolbar shows. A non-round sketch doubled at the toolbar's 3 decimals still reads "stretched (width 200%, height 200%)" in 7 of 12 cases, and Apply returns it to half size.
- **R6-P2-3 (accepted by ADR-637 Amd 4, weakly warned).** A profile widened on 1.0.28 stops at X 358 for Move laser here, but Frame and an Absolute job go to X 362 and preflight passes.

## Fix matrix

| Original finding | Before (literal parent) | After (main) | Siblings | Verdict |
|---|---|---|---|---|
| **N5-P2-2**, restore the older autosave | 5 of 12 `design-kept-drawings.test.tsx` cases fail on the parent (`expected [] to deeply equal [drawing]`) | S1: Studio opens `[applied]`, kept `[applied,l1,l2]`. Bar: "An applied drawing this project does not hold was kept: 3 shapes, kept …". Restore, then Apply: 3 objects, 1 operation | S3 two Applies 3 objects. S4 Apply then edits: "A drawing you had not applied", 4 objects. S14 restored drawing in slot, crash again: comes back. **S11, S12, S8 lost (R6-P1-1)** | **Fixed as reported; sibling P1** |
| **N5-P2-2**, restore declined | Parent keeps `[]` (v8 refuter) | S2: blank Studio, offered, Restore + Apply = 3 objects | S5 no autosave at all: same | **Fixed** |
| ADR-590 Amd 2, offers | S6, S7a, S10, S16: no offer on the parent; S13 keeps the unapplied drawing | **S6, S7a, S10, S16 offer; S13 evicts** | S7b own unrelated drawing: not kept. S9 a file holding its drawing, 5 reopens: 0 false offers | **Regressions (R6-P1-2, R6-P2-1, R6-P3-2)** |
| **N5-P2-1**, W then H | Parent `{w:60,h:30}` | T1: `even` factor 2.0000000333, notice "resized to 200%", Apply 120 × 60, scale 1. T2: 0 of 32 stretched, 0 wrong | T6 negative, 30° and mirrored: same outline before and after; group: both `even`. T7 part: 90 × 60. **T4 non-round: 7 of 12 stretched (R6-P2-2)** | **Fixed on round sizes; gap** |
| ADR-573 Amd 2 item 4, genuine stretch | n/a | T3 on 120 × H: 60.001, 60.0001 and 60.00004 stretch; 60.00003, 60.00001 and 60.000001 fold. Edge is as written (5e-7) | Tiny sources fold at most 4 µm (T5) | **Holds** |
| **N2-P2-1**, offer | Simulator fails on the parent at `bedWidth` 363 | A1: rows are Z travel and Acceleration only; sends `$$`, `$G` only | Stock GRBL, `$21=0`, `$27=0`, FluidNC banner keep the raw travel. Family table clean | **Fixed** |
| **N2-P2-1**, Job Review | Warning tone on the preset | "363 × 273 mm, homed area 358 × 268 mm", default tone | Widened: warns. Start `$30`/`$32` verified | **Fixed** |
| **N2-P2-1**, jog limits | 0..363 on a widened bed | Preset 0..358 × 0..268. Clicks at (358,268) and (400,300) send `G1 X358.000`. Widened limits 0..358 | **Frame and Absolute preflight still 0..363 (R6-P2-3)** | **Fixed for jog; gap** |
| N2-P2-1, firmware model | n/a | A6: all 8 force, direction and hard-limit combinations equal `machine_limits.c` | Generic grblHAL at 400: offered 398 (R6-P3-1) | **Holds** |
| N2-P3-5 | Gap | New simulator and e2e assertions present; simulator 2/2 on main, 2/2 fail on parent | — | **Fixed** |
| **N7-P3-2** | Threw before recording | `Save-UpgradeAppExit` before the verdict, in `finally` for an early end, parent quotes the error | Shell-open early exit and close hangs keep no code or log (R6-P3-5) | **Holds, not exercised** |

## Findings

### R6-P1-1 — An applied Studio drawing is still written over when the project opened shares no shape and no operation with it: redraw on a new layer, Apply empty then redraw, or open another Studio project first after a crash

- **Where:**
  - `src/ui/design-studio/design-kept-drawings.ts:76-83` (`mayPrecede`) and `:58-61` (`worthKeeping`).
  - `src/ui/design-studio/design-draft-recovery.ts:105-108` (`setAside` returns without keeping).
  - `src/ui/state/design-apply-mutation.ts:104,112`: the apply record holds only this Apply's layers, and an emptied operation is removed.
- **Anchor:**
  - **Contract: ADR-590 Amd 2 Context** says an Apply in the 30 s before a crash is in the saved drawing and not in the autosave. Its Consequences say the Studio offers that drawing back "whether the autosave is restored or not".
  - **ADR-590 Amd 2 item 1** rests on the premise that the other project's "file holds it". That is about the other project's drawing. After a crash, nothing holds this one.
  - **Design severity (rolling v7):** "Losing design work also counts."
- **Scenario:** the project autosaves with one applied line. Within 30 s, one of:
  - **S11:** delete it, draw three lines on a new Studio layer, Apply.
  - **S12:** delete it, Apply (the operation is dropped), draw three lines, Apply.
  - **S8:** apply three lines, crash, then open another project with its own Studio drawing (File > Open or a shell-open) and open the Studio before restoring.

  Restore the autosave and open the Studio. The newer drawing is gone: no bar, no toast.
- **Evidence:** REPRO, `zz-r6-studio.test.tsx`:
  ```
  S11 before {"slot":["n1","n2","n3"],"dirty":false,"objects":3}
  S11 after  {"shapes":["applied"],"kept":[],"slot":["applied"],"bar":""}
  S12 empty apply {"objects":0,"ops":0}
  S12 after  {"shapes":["applied"],"kept":[],"slot":["applied"]}
  S8 on Q    {"shapes":["other"],"kept":[],"slot":["other"]}
  S8 back on the autosave {"shapes":["applied"],"kept":[],"slot":["applied"]}
  ```
  Control S12b (redraw on the same layer, one Apply): kept, because the operation survives.
- **Severity:** P1. Same effect as N5-P2-2, which was rated P1: the only copy is overwritten with no warning. **For the refuter:** the workspace loses the same Apply from the 30 s autosave, the case for P2 recorded in N5-P2-2. Reach cannot lower it (§3).
- **Refuter:** CONFIRMED, P1 kept.
  - **What would make it false:** a surviving copy, a notice, or routes that do not reach the overwrite.
  - **Result:** own repro with the real hook, the Studio's Apply and a project round trip. S11, S12 and S8 all end with `kept:[]`, `bar:""` and the slot holding the older drawing. `setAside` returns without a toast, and the recovery text still says "continue where you left off". So no warning reaches the operator, and §3 does not allow a lower rating.
  - **How narrow it is:** none of the three routes is everyday use.
    - **Controls that keep the drawing:** delete all and redraw on the same layer (S12b), keep one old shape and add a layer (S11k), and open the Studio on the blank project before restoring (S11b).
    - **What a loss needs:** a crash within 30 s of the Apply, and an autosave older than that Apply. Without a crash the project holds the drawing and nothing is lost.
    - **What is at risk:** more than 30 s of work. The Studio's edits reach the project only at Apply, so a long drawing is all in that one Apply. Until the Apply the slot marks the drawing unapplied (`dirtySinceApply`), and any route that opens another project keeps it. The Apply removes that protection.
  - **S8 is weaker than S11 and S12 as a defect.** ADR-590 Amd 2 Consequences decide it: "An applied drawing set aside for a project with its own, unrelated Studio drawing is still not kept." Its stated reason covers only the other project's file. The P1 stands on S11 and S12 alone, where the older autosave of the same project is what the Studio opens. Item 1's test of "earlier state" fails there.
- **Fix direction:** decide by whether a file or autosave holds the drawing, not by resemblance. For example, stamp the slot when a save or autosave captures its owner key, and keep any applied, unstamped drawing. That also removes R6-P1-2's and R6-P2-1's offers.

### R6-P1-2 — Applied drawings their own files hold now count toward the five kept drawings, so ordinary File > New work evicts a real unapplied drawing with no notice (regression from #1521)

- **Where:** `src/ui/design-studio/design-kept-drawings.ts:27` (`MAX_KEPT`), `:117` (`slice(0, MAX_KEPT)`), `:60-61,77` (a project with no Studio drawing always "may precede").
- **Anchor:**
  - **Contract: ADR-590 Amd 1 item 2** decides "past five, the oldest is dropped". It set that cap when only unapplied work was kept. Amd 2 does not revisit it.
  - **Twin:** literal parent `5b4c82caa^1` against main.
  - **Design severity:** "Losing design work also counts."
- **Scenario:** a kept unapplied drawing is waiting. The operator then makes five small projects in the Studio (draw, Apply, Save, File > New, open the Studio). Each saved drawing is kept. The sixth entry drops the unapplied one.
- **Evidence:** REPRO, S13:
  ```
  main:   kept first [UNAPPLIED dirty:true]
          after five New [p5, p4, p3, p2, p1 all dirty:false]
  parent: after five New [UNAPPLIED dirty:true]
  ```
  The repro skips the Save step itself. A project that holds its drawing is not checked at this point, because the New project is what is compared.
- **Severity:** P1 as raised: design work silently lost, and it is a regression. **For the refuter:** the ADR accepts a cap. What it did not accept is entries that lose nothing filling that cap. Five such Studio sessions without a Discard is the reach; reach cannot lower it. Lowering needs a warning, and the only text is "N older kept".
- **Refuter:** CONFIRMED, P1 kept.
  - **What would make it false:** the real New clearing or sparing the entry, a notice at eviction, or the same drop on the older code.
  - **Result:** own repro with the real `newProject()` and the real bar, run on main and on a 1.0.28 export (which predates #1521).
    ```
    main  step 4 kept [p4,p3,p2,p1,UNAPPLIED+U2]  bar "... 4 older kept."
    main  step 5 kept [p5,p4,p3,p2,p1]            bar "... 4 older kept."   toasts []
    1.0.28 steps 1-5 kept [UNAPPLIED+U2]          bar "A drawing you had not applied was kept: 2 shapes"
    ```
  - **Eviction is silent.** The bar's text is the same before and after the drop, and no toast fires. "N older kept" says nothing about a cap. Discarding the newer entries is the only way to reach the older one (N5-P3-4), so by step 4 the unapplied drawing was already out of sight.
  - **An applied drawing whose project is saved adds nothing.** The file holds it, so these entries take slots and protect nothing. The kept list has no way to tell, because it does not record whether a file holds the drawing. No module outside `design-studio/` imports the slot or the kept list, so the project Save path does not write them. The repro does not run a disk Save, which should not affect the result.
  - **Not a defence:** ADR-590 Amd 1 item 2 accepts dropping the oldest of five. It decided that when every entry was unapplied work.
  - **Reach, noted but not used to lower it (§3):** five Studio projects without a Discard, or a file reopened in the Studio. The list persists across restarts, so this can build up over days. #1521 is not in Desktop 1.0.28, so a fix before the next desktop release keeps it from reaching desktop users.
- **Fix direction:** evict held or applied entries before unapplied ones. Better, stop keeping drawings a file holds (R6-P1-1's stamp).

### R6-P2-1 — File > New, an ordinary restart, or opening a project with no Studio drawing offers the previous project's fully saved drawing, until it is discarded or its file is opened in the Studio (regression from #1521)

- **Where:** `src/ui/design-studio/design-kept-drawings.ts:76-78` (`own === undefined` returns true); `DesignKeptDrawingBar.tsx:26-29`.
- **Anchor:**
  - **Contract: ADR-590 Amd 2 Consequences:** "A drawing a restart finds on the blank start-up project is offered there". New is not a restart, and an unrelated Studio-less file is not "an earlier state".
  - **ADR-590 Amd 2 item 1:** "may be an earlier state of the project it was applied to". The code cannot tell these apart.
- **Scenario:** draw and Apply in P, then save. File > New (or open an SVG-only project), open the Studio. The bar appears. Restore, then Apply, adds P's three shapes to the unrelated job. The bar stays on every later Studio open that is not P.
- **Evidence:** REPRO:
  ```
  S6  {"epoch":1,"shapes":[],"kept":[{"shapes":["applied","l1","l2"],"dirty":false}],
       "bar":"An applied drawing this project does not hold was kept: 3 shapes, kept Nov 2, 2026, 11:34 AM.RestoreDiscard…"}
  S6 restored into New {"objects":3}
  S7a same bar on a project holding only an imported SVG
  S10 counts [1,1], then on the file: kept []
  parent: S6, S7a kept [], bar ""; S10 counts [0,0]
  ```
- **Severity:** P2. The wording is literally true and it asks before doing anything, so nothing is lost. It reads as a recovery after nothing went wrong, and it can put another project's artwork into this job. It also feeds R6-P1-2.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** a label naming the source project, a dismissal that sticks, or the ADR deciding every route.
  - **Result (own repro):**
    - **New:** kept `[a+b+c]`, and the bar comes back on each Studio open.
    - **SVG-only project:** Restore then Apply gives 4 objects (3 plus the SVG).
    - **Project that holds its drawing:** no bar. So this is not a false offer on every open.
  - **Label:** the bar gives a shape count and a time. It never names the source project, and it makes no "newer than" claim.
  - **Dismissal:** Discard asks first and sticks across later Studio opens and New. It comes back only after that file is opened in the Studio and left again (`P21 file then New`).
  - **What the ADR decides:** Amd 2 Consequences accept the restart case by name ("offered there even when its file holds it"), and item 1 covers a "file from before the first Apply", which a Studio-less file looks like. File > New is not named. So the restart route is decided behaviour and the New route is the clearest defect.
  - **Why not P3:** an ordinary user meets this after every New that follows Studio work, and it reads as a recovery after nothing went wrong. **Why not P1:** it takes two explicit clicks, Undo is available, and nothing is lost.
- **Fix direction:** as R6-P1-1. At least, do not treat a project at epoch > 0 with no Studio drawing as an earlier state unless its objects overlap the drawing's apply record.

### R6-P2-2 — An even resize typed at the toolbar's own precision on a non-round sketch still reads as stretched, in 7 of 12 cases, and Apply returns it to the original size

- **Where:** `src/core/scene/retained-source-scale.ts:40,51-53` (tolerance 1e-5 mm); `src/ui/commands/NumericEditsBar.tsx:25,435` (W/H show 3 decimals); `src/ui/layers/RetainedScaleNotice.tsx:26-27,36-38` (percent to 2 decimals).
- **Anchor:**
  - **Contract: ADR-573 Amd 1 item 1** (an even scale is folded) and **Amd 2** ("no resize anyone could see" in `retained-source-scale.ts:29`).
  - **Twin:** N5-P2-1's stated defect, the notice's equal percentages against its verdict, is unchanged here.
- **Scenario:** a 100 × 86.603 sketch (a hexagon's bounds). Read the toolbar and type W 200, H 173.205 with the lock off. The notice says "stretched (width 200%, height 200%)". Apply burns 100 × 86.603.
- **Evidence:** REPRO, `zz-r6-scale.test.tsx` T4 (`stretched 7 of 12`):
  ```
  100/3 x 20,   x2: W 66.667 H 40      stretched, canvas 66.667x40    → after Apply 33.333x20
  70 x 70/3,    x2: W 140 H 46.667     stretched, canvas 140x46.667   → 70x23.333
  100 x 86.60254, x2: W 200 H 173.205  stretched, canvas 200x173.205  → 100x86.603
  41.4214 x 12.5, x1.5: W 62.132 H 18.75 stretched → 41.421x12.5
  ```
  Round sizes fold. T3: a genuine 120 × 60.001 also reads "width 200%, height 200%", and Apply gives 60 × 30.
- **Severity:** P2, as N5-P2-1. The alert and the review's size line both reach the operator before Apply. The ADR's "a stretch anyone could measure" is met only in nanometres here: the rounding is under 0.0005 mm of a typed field.
- **Refuter:** CONFIRMED, P2 kept, and the reach is wider than reported.
  - **What would make it false:** only exotic sketches being affected, or the alert not reaching the operator (which would raise it).
  - **Result:** it does not need a non-round sketch. A **round** source with a non-terminating factor also trips it:
    ```
    120 x 70  -> W 100 H 58.333   stretched (83.33%, 83.33%)     fields 120, 70  after Apply 120 x 70
    70 x 45   -> W 100 H 64.286   stretched (142.86%, 142.86%)   fields 70, 45   after Apply 70 x 45
    30 x 17   -> W 100 H 56.667   stretched (333.33%, 333.34%)   fields 30, 17   after Apply 30 x 17
    100 x 86.60254 -> W 200 H 173.205  stretched (200%, 200%)    fields 100, 86.60254  after Apply 100 x 86.603
    controls fold: 60x30->100x50, 60x30->120x60, 150x90->100x60, 33.333x20->66.666x40
    ```
    Those controls keep their typed size after Apply. The lock is off by default (per `retained-source-canvas-resize.test.ts`'s `typeSize` comment).
  - **The alert is clear about the outcome,** which is why this stays P2 and not P1: "Its dimensions keep one scale, so applying returns it to the sizes here…" appears before Apply, the fields show the smaller sizes, and it offers Bake as vectors. Only the opened editor shows it, and the job burns as typed until that editor applies. Its verdict still contradicts its own numbers (200% and 200%, called stretched).
- **Fix direction:** let the tolerance cover what the field can express, about 0.0005 mm per side as well as the solver's. Print enough digits that a real stretch shows unequal percentages.

### R6-P2-3 — On a profile widened on 1.0.28, Move laser here stops at X 358, but Frame and an Absolute job still go to X 362 and preflight passes

- **Where:** `src/core/preflight/preflight.ts:317` (bed only); `src/ui/state/native-bed-frame.ts:102-108`; `src/ui/state/laser-frame-motion-plan.ts:33-34` (no limit); twin `src/ui/state/manual-motion-limits.ts:52-56`.
- **Anchor:**
  - **Twin:** the jog box against the job and Frame box in one session.
  - **Ground truth:** `machine_limits.c` L114-L139 @ [`f8f10aec`](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/machine_limits.c#L114-L139), fetched 2026-11-02: "When hard limits are enabled pulloff distance is subtracted".
  - **Contract:** ADR-637 Amd 4 Consequences accept it: "Its frame and preflight still use the saved bed until the operator takes the offer."
- **Scenario:** the real 1.0.28 code accepts the offer and saves 363 × 273 (L11). On main, connect and Home. A job reaching X 362 passes preflight and Frame sends X 362 (N2-P2-1's refuter showed `$20=0` and G1 moves are not stopped by the firmware).
- **Evidence:** REPRO, `zz-r6-a1pro.test.ts` A7, `zz-r6-l11.test.tsx`:
  ```
  A7 box {"frame":{"maxX":363,"maxY":273},"limits":{"maxX":358,"maxY":268}}
  A7 job {"maxX":362,"issues":[]}         preset bed: ["Line 9: X out of bed: 362"]
  A7 Frame [...,"G1 X362.000 Y100.000 F3000 S0",...]
  L11 last machine {"bed":[363,273]}; offer Bed 363→358, 273→268; fact warning; accepted bed [358,268]
  ```
- **Severity:** P2, as N2-P2-1. The specific mismatch does reach the operator (the warning-tone fact in Job Review), and the physical limit past 358 is unverified. **Weaknesses:** the connect toast is generic and Frame alone shows no Job Review. Re-rate to P1 if the maintainer's unit cannot reach X 363 after a Home.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** the real saved profile not loading wide, Frame or preflight being clamped, a firmware stop, or no warning at all (which would raise it).
  - **Real profile:** the 1.0.28 export's own code, on the published dump, offered 358→363 and 268→273. Use detected values and `rememberLastMachine` wrote the document, and main's `loadLastMachineSelection` loaded it at 363 × 273, `creality-falcon-a1-pro`.
  - **On main, after connect and Home:**
    ```
    box        frame maxX 363 maxY 273   limits maxX 358 maxY 268
    Frame      G1 X362.000 Y50.000 F3000 S0 ... outcome done (no clamp, no refusal)
    preflight  widened: no out-of-bed issue   same G-code on a 358 bed: "Line 4: X out of bed: 362"
    Move laser here at (362,100), same profile, in a separate run before Frame was added: G1 X358.000 Y173.000
    accept     bed 358 x 268, plain travel fact, frame and limits both 358 x 268, no controller write
    ```
  - **What the operator sees:**
    - **Toast:** "Machine settings detected: profile updates and review items are ready in Machine Setup." It does not name the bed. The A1 Pro preset's acceleration offer shows the same text, since the review items are there too.
    - **Offer rows:** Bed width 363→358 and Bed height 273→268.
    - **Job Review, warning tone:** "363 × 273 mm, homed area 358 × 268 mm — profile bed 363 × 273 mm". This names the specific mismatch before Start, which meets §3's test, though it does not state the consequence. Frame alone shows none of this.
  - **ADR wording:** the quote is exact, ADR-637 Amd 4 Consequences: "Its frame and preflight still use the saved bed until the operator takes the offer."
  - **Firmware claim re-fetched at `f8f10aec` and holds:** the published dump has `$20=0`. `settings.c:1147` sets `sys.soft_limits.mask` only when soft limits are on. `gcode.c:791` checks travel only when that mask is set, and `gcode.c:3023` marks the target validated when it is 0, so `motion_control.c:88-89` skips `limits_soft_check`. `machine_limits.c` subtracts the pull-off as cited. With hard limits on, only the switch stops motion, and the switch is at the far end from X 362. X 362 is 367 mm from the switch, 4 mm past `$130`'s 363.
  - **Repair offer:** a one-time, named offer is safe. Accepting writes only the profile, and the result above is correct. Applying it automatically is not: this bed's Y map is `bedHeight − y` (the click at canvas y 100 went to Y 173 on the 273 bed), so a silent change moves a job's machine Y by 5 mm against what the operator placed on the old canvas.
  - **Severity:** stays P2 because of the specific warning and because the physical limit is unverified. As the report says, re-rate to P1 if the unit cannot reach past 358.
- **Fix direction:** pull preflight and Frame in by the same `resolveManualMotionLimits` box when `$$` was read this session, as a named warning. Or name the 5 mm in the toast.

### R6-P3-1 — A grblHAL machine whose bed equals its travel is offered a smaller bed at every connect, warns at every Start until accepted, and then Machine Setup reads as asking for `$130` to change

- **Where:** `src/ui/state/detected-settings-action.ts:153`; `job-review-live-rows.ts:414`; `device-setup-firmware-diff.ts:127-128`; `DeviceSetupFirmwareStep.tsx:129`.
- **Anchor:** ADR-637 Amd 4 Consequences decide the offer. The firmware envelope agrees (A6), so the offer is not wrong. **Twin:** the review row against the offer.
- **Evidence:** REPRO A4, Generic grblHAL 400 × 400, `$21=1`:
  ```
  rows Bed width 400→398, Bed height 400→398; fact warning "homed area 398 × 398 mm — profile bed 400 × 400 mm"
  afterRows ["$130","400.000","398",differs true,writable false]
  ```
  The row reads "controller 400.000 → profile 398. Check the hardware manual and use the controller manufacturer's procedure". Following it by hand makes the next offer 396. `writable` is false, so the app never writes it. Hard limits off: no offer.
- **Severity:** P3. Safe direction, decided by the ADR, nothing written.
- **Refuter:** CONFIRMED, P3 kept. Own repro with `$130=$131=400`, `$27=1`, `$22=35`: rows 400→398, warning fact, and after accepting a plain fact at 398 × 398. The review-only wording is at `DeviceSetupFirmwareStep.tsx:129` and `diffedSettings` still compares `$130` with the bed. `writable` comes from `row.writeRisk`; the `false` for `$130` is the auditor's output, not re-run.
- **Fix direction:** compare `$130` with the homed area in that step. Use a plain tone when the bed is within the pull-off of the travel.

### R6-P3-2 — Older revisions and visibility: opening a newer file offers the older drawing, each way, and the lost Apply is invisible outside the Studio

- **Where:** `design-kept-drawings.ts:79-80`; `AutosaveRecoveryControl.tsx:52`.
- **Anchor:** **Contract: ADR-590 Amd 2 item 1**, "an earlier state": the older drawing is not one. **Scope question:** "is the wording clear?".
- **Evidence:** REPRO, S16. Newer file open: kept `[applied]`, bar "An applied drawing this project does not hold… 1 shape". Older file again: kept 3 shapes. The parent keeps `[]`. READ: the recovery offer still reads "Restore it to continue where you left off", and the bar exists only inside the Studio. An operator who never opens the Studio is not told the last Apply is recoverable.
- **Severity:** P3. Nothing is lost.
- **Refuter:** CONFIRMED, P3 kept. Own repro with two revisions of one project: older open keeps the 3-shape drawing (correct), newer open keeps and offers the 1-shape older one, older again offers the 3-shape one. The recovery text at `AutosaveRecoveryControl.tsx:52` and the bar's Studio-only placement were read as reported.
- **Fix direction:** keep only a drawing newer than the opened project. Add one line to the recovery result when the slot holds a drawing the restored project does not.

### R6-P3-3 — On the A1 Pro preset, an unpublished `$22=35` is offered 353 × 263 while the frame stays 0..358 (latent)

- **Where:** `manual-motion-limits.ts:182-190` (disjoint boxes keep the frame); `native-bed-frame.ts:122-135`.
- **Anchor:** **Twin:** the offer against the jog box. **Ground truth:** no force origin makes the envelope −358..−5.
- **Evidence:** REPRO A2: `Bed width 358→353`, fact warning, box 0..358. `$23=0` gives no offer, and its envelope −358..0 is also ignored. Both published units read `$22=43 $23=3`.
- **Severity:** P3, latent.
- **Refuter:** CONFIRMED, P3 kept (latent). Own repro with `$22=35` on the preset: rows 358→353 and 268→263, warning fact "homed area 353 × 263 mm", frame and limits both 0..358 × 0..268. The `$23=0` case was not re-run.
- **Fix direction:** say the settings disagree with the vendor contract, in the fact (extends N2-P3-3).

### R6-P3-4 — A fold keeps the solver's noise in the sketch's dimensions

- **Where:** `src/core/scene/retained-source-scale.ts:67-69` (12 significant digits).
- **Anchor:** the function's own comment ("so a folded 60 × 1.1 reads 66").
- **Evidence:** REPRO T1: `outline1_width 120.000002, outline1_height 60.000001`. Burn rounds to 120 × 60. How the editor field displays it was not checked.
- **Severity:** P3 (polish).
- **Refuter:** CONFIRMED, P3 kept. Own repro on a solved custom rectangle: factor 2.000000033333184, `outline1_width` 120.000002. A default plate is clean (120, 60, 8), so only solved sketches show it. This settles the report's open point: `SketchParameterEditor.tsx:68` renders `String(p.value)`, so the field shows 120.000002.
- **Fix direction:** round to the solver's tolerance.

### R6-P3-5 — Harness gaps: a shell-open app that ends early keeps no code, and a close that hangs keeps no log

- **Where:** `scripts/qualify-windows-installer.ps1:316,321-323,340-351`; `scripts/installed-upgrade-profile.ps1:121,276-286`.
- **Anchor:** **Twin:** the upgrade driver's `finally` records an app that ended on its own; `Invoke-AssociatedProject` does not. PR #1525 says "Same treatment for the other close check". The observation records `exited` only (`installer-association-evidence.ps1:15-18`).
- **Scenario:**
  - A crash during the 45 s title wait throws with no `exitCode` or `app-exit` copy.
  - "did not close normally" kills the process in either script and keeps no support log. A hang at close is what the log tail could classify.
  - The shell-open call passes no `$Redact`, though the parent holds the qualification key. The app's log strips keys (ADR-546), so this is depth only.
- **Evidence:** READ. Parser clean on all three files (`Parser::ParseFile`, 0 errors); 0 non-ASCII bytes in the helper and the profile script.
- **Severity:** P3.
- **Refuter:** PLAUSIBLE, P3 kept. Read in full, not run, and no real release run has exercised either path (the latest 3 `release-desktop-unsigned.yml` runs are `skipped`).
  - **Holds as read:** the 45 s wait throws with no code, and `catch` only adds an observation. Both "did not close normally" paths kill the process in `finally` without `Save-InstalledAppExitEvidence`. The shell-open call passes no redaction argument, and the upgrade path passes `$licenceKey`.
  - **Correction:** a hang is not wholly without evidence in the shell-open path, because `catch` keeps `Save-AssociationWindowEvidence` for a live process. That is window evidence, not the support log, so the finding stands.
  - **PR text:** #1525's "Same treatment for the other close check" is accurate for the normal close, which is what it changed.
- **Fix direction:** one `finally` helper in both paths; collect the log on a hang as well.

### R6-P3-6 — ADR drift and test gaps

- **ADR-590 Amd 2 Consequences:** "Other projects are unchanged" is false for a project with no Studio drawing (R6-P2-1). The "older" and "file holds it" reasoning does not cover R6-P1-1.
- **`design-kept-drawings.test.tsx`** has one "another project" guard, with its own unrelated drawing. No case covers New, a Studio-less file, a new layer, an empty Apply, or the cap.
- **`retained-source-scale.test.ts`:** all 4 fail on the parent, but through the API change (`NaN`), not at the defect. `retained-source-canvas-resize.test.ts` is the real fix test and fails at `{w:60,h:30}`.
- **No test** types W and H at toolbar precision on a non-round sketch.
- **`job-review-live-rows.test.ts`:** one of its 3 parent failures is ADR-684's (#1528), not #1520's. The other 2 are at the defect.
- **Evidence:** REPRO and READ. **Severity:** P3.
- **Refuter:** CONFIRMED, P3 kept. The ADR sentence "Other projects are unchanged" is quoted exactly and is contradicted by this report's New and SVG-only repros. The test list of `design-kept-drawings.test.tsx` has no New, Studio-less file, new layer, empty Apply or applied-entries-at-the-cap case. Neither resize test file has a toolbar-precision case. The parent-failure counts for `retained-source-scale.test.ts` and `job-review-live-rows.test.ts` were not re-run.

## Refuter method

Fresh context; the auditor's repro files had been deleted and were not reused.

- **Tree:** `j7-main` at `54e0e19b8`, plus a `git archive` export of `33bc394c6` (Desktop 1.0.28, which predates #1520 and #1521) outside it, served through a Vite plugin (`R6R_TREE`).
- **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-r6r-vitest.config.ts --silent=false --disableConsoleIntercept`.
- **`zz-r6r-studio.test.tsx`:** real persistence hook, real bar, the Studio's Apply, project round trip, real `newProject()`. Routes S8, S11, S12, S13, S16, New, Discard, SVG-only, plus controls S11u, S11b, S11k and S12b. S13 also ran on 1.0.28.
- **`zz-r6r-a1.test.ts`:** fake port with the published banner and dump. 1.0.28 accepted the offer and wrote the last-machine document; main loaded it and ran connect, Home, Frame and preflight. Also the `$22=35` and generic 400 × 400 variants.
- **`zz-r6r-scale.test.tsx`:** real toolbar edit builder with values rounded as the field shows them, the real notice, real editor open, Apply and `compileJob`.
- **Primary source:** `grblHAL/core` at `f8f10aec` re-fetched (`machine_limits.c`, `motion_control.c`, `gcode.c`, `settings.c`).
- **Limits:** jsdom and store level; no packaged build, real crash, pointer input or hardware. The crash is the existing test's state reset onto a round-tripped autosave.

All `zz-r6r-*` files and exports were deleted afterwards, one literal path at a time for those inside `j7-main`.

## KNOWN re-observed

- **R7 "A 1.0.28 copy widened":** R7 deferred the repro here; done above (R6-P2-3).
- **N5-P3-3:** the held slot, not re-run.
- **N5-P3-4:** only the newest kept drawing is reachable; S13's list shows "older kept" still has no route. Not raised again.
- **N2-P3-3:** `$22=0` is still a plain fact and now also offers Bed 358→363 (A2), decided by ADR-637 Amd 4 item 1. No frame without Home.

## Refuted

The refuter refuted none of the 11 findings. The items below are the auditor's own rejected candidates.

- **"The new tolerance is too wide."** No. Burn error is at most tolerance × factor on the shorter side: 4 µm on a 0.5 mm source at 200× (T5).
- **"The fold moves a negative, mirrored, rotated or grouped sketch."** No (T6).
- **"The offer can ratchet by itself."** No. `$130` rows are `writable: false`.
- **"`$27=0`, `$21=0`, or a banner change corrupts the jog box."** No (A2, A3).
- **"The homed area model disagrees with grblHAL."** No: 8 of 8 (A6).
- **"The evidence helper can fail a healthy run."** No. Exit 0 records the code and collects nothing. It never throws out of its parts, and only a failing run waits the bounded 10 s.
- **"Evidence reads the wrong log."** No: `userData\logs\kerfdesk.log`, and the regex and "KerfDesk quit." match `electron/support-log.ts:143,210`.
- **"`$profile` is PowerShell's automatic variable in the shell-open call."** No: assigned at `qualify-windows-installer.ps1:77`.

## Verified clean

- **ADR-573 Amd 2 items 1-4** against the code, including the longer side's factor and the 60 × 30 edge.
- **ADR-590 Amd 2 items 2 and 3:** bar wording; Restore takes the project's apply record (3 objects, not 4), and Apply is on.
- **ADR-637 Amd 4 items 1-5:** values, wording strings, stock GRBL (`A5`: no inset), FluidNC and others (`null`), no write sent.
- **False offer on a held project:** S9, 5 reopens of a file with line, rect, circle and path: 0.
- **L11 Studio:** 1.0.28 project and slot on main: newer file opens with kept 0 and byte-identical G-code; older autosave and blank offer the drawing.
- **L11 device:** a 1.0.28 last-machine document at 363 × 273 loads, is offered 358 × 268, warns, and repairs on accept. A project file carrying 363 × 273 opened on the preset takes the file's bed with the reconciliation notice (`deviceIdentity` differs), and the next connect offers it back.
- **Test truth:** on the literal parents' changed files: kept 5 of 12 fail, resize 1 of 7 fails, simulator 2 of 2, limits 1 of 30.
- **Harness:** the code goes in decimal and hex first in `create`, `reopen` and `release`, all through one function. The tail starts on a whole line, the key is removed, events are limited to the executable since the phase began. The artifact holds a runner's disposable profile.

## Not verified

- **Any real release evidence.** `gh run list --workflow release-desktop-unsigned.yml`: the 5 latest are `skipped`; the last real run is `40847952302` (1.0.28), before #1525 merged. Nothing was dispatched. The new test was not run here (the brief asked for a syntax check).
- **The real crash, a packaged build, pointer input.** Store and hook level in jsdom.
- **The maintainer's A1 Pro.** Whether the head can reach X 363 remains open.
- **Listed grblHAL presets' real dumps** (Ortur LM3): the R6-P3-1 result used hypothetical settings on the generic profile.
- **`$810`–`$813` in the dump** against grblHAL's `homing_pulloff`: not traced. The model uses `$27`.

## Repro files

All were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\` and deleted individually after the runs. No `zz-r5*` file was opened beyond reading its config for the pattern. No repo file other than this report was touched.

| File | What it did |
|---|---|
| `j7-main\zz-r6-vitest.config.ts`, `j7-main\zz-r6-fflate-stub.ts` | Repo config, `fflate` stub, one worker, the `R6_TREE`/`R6_ONLY` plugin |
| `j7-main\src\ui\design-studio\zz-r6-studio.test.tsx` | S1–S16: every Studio route above, on main and the #1521 parent |
| `j7-main\src\ui\state\zz-r6-scale.test.tsx` | T1–T7: W then H, sweep, tolerance edge, non-round, tiny sources, transforms, group, part |
| `j7-main\src\ui\state\zz-r6-a1pro.test.ts` | A1–A7: fake-port connect and Home, firmware variants, banners, generic grblHAL, stock GRBL, family table, source model, widened bed with preflight and Frame |
| `j7-main\src\ui\design-studio\zz-r6-l11.test.tsx` | Save with 1.0.28's code, open on main |
| `zz-r6-trees\` (outside `j7-main`) | Exports of `33bc394c6`, `5b4c82caa^1`, `696496c8a^1`, and the L11 JSON |
| `%TEMP%\zz-r6-{e,p,q}.ps1` | `git show` copies for the parser check |

```json
[
  {"id":"R6-P1-1","severity":"P1","area":"fix-studio-bed","file":"src/ui/design-studio/design-kept-drawings.ts","line":76,"anchor":"Contract: ADR-590 Amd 2 Context and Consequences (offered back whether the autosave is restored or not); design severity v7","evidence":"REPRO","verdict":"CONFIRMED","known":"sibling of v8 N5-P2-2","summary":"An applied drawing sharing no shape or operation with the opened project is overwritten silently: redraw on a new layer, Apply empty then redraw, or open another Studio project first after a crash"},
  {"id":"R6-P1-2","severity":"P1","area":"fix-studio-bed","file":"src/ui/design-studio/design-kept-drawings.ts","line":117,"anchor":"Twin: parent 5b4c82caa^1 vs main; ADR-590 Amd 1 item 2 set the cap for unapplied work; design severity v7","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1521: five applied drawings kept on File > New evict a real unapplied kept drawing with no notice; the parent keeps it"},
  {"id":"R6-P2-1","severity":"P2","area":"fix-studio-bed","file":"src/ui/design-studio/design-kept-drawings.ts","line":77,"anchor":"Contract: ADR-590 Amd 2 item 1 'may be an earlier state' and Consequences","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1521: New, a restart or a Studio-less project offers the previous project's saved drawing until discarded or its file is opened in the Studio; Restore + Apply adds it to the job"},
  {"id":"R6-P2-2","severity":"P2","area":"fix-studio-bed","file":"src/core/scene/retained-source-scale.ts","line":40,"anchor":"Contract: ADR-573 Amd 1 item 1, Amd 2; Twin: equal percentages vs verdict","evidence":"REPRO","verdict":"CONFIRMED","known":"residual of v8 N5-P2-1","summary":"W and H typed at the toolbar's 3 decimals on a non-round sketch read 'stretched (200%, 200%)' in 7 of 12 cases, and round sources with a non-terminating factor do too (120 x 70 to W 100 H 58.333); Apply returns the original size; warned by the alert"},
  {"id":"R6-P2-3","severity":"P2","area":"fix-studio-bed","file":"src/core/preflight/preflight.ts","line":317,"anchor":"Twin: jog box vs preflight and Frame; Ground truth: grblHAL machine_limits.c L114-139 @ f8f10aec; ADR-637 Amd 4 Consequences accept it","evidence":"REPRO","verdict":"CONFIRMED","known":"residual of v8 N2-P2-1","summary":"A profile widened on 1.0.28: Move laser here stops at 358 but Frame and an Absolute job go to X 362 and preflight passes; only a warning-tone fact and a generic toast"},
  {"id":"R6-P3-1","severity":"P3","area":"fix-studio-bed","file":"src/ui/laser/device-setup/device-setup-firmware-diff.ts","line":127,"anchor":"Twin: review row vs offer; ADR-637 Amd 4 decides the offer","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"grblHAL with bed = travel is offered 2 x pull-off smaller at each connect, warns at each Start, and the review row then reads as asking to change $130"},
  {"id":"R6-P3-2","severity":"P3","area":"fix-studio-bed","file":"src/ui/design-studio/design-kept-drawings.ts","line":79,"anchor":"Contract: ADR-590 Amd 2 item 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Opening a newer file offers the older drawing, each way; the lost Apply is invisible outside the Studio"},
  {"id":"R6-P3-3","severity":"P3","area":"fix-studio-bed","file":"src/ui/state/manual-motion-limits.ts","line":183,"anchor":"Twin: offer vs jog box","evidence":"REPRO","verdict":"CONFIRMED","known":"extends v8 N2-P3-3","summary":"Latent: an A1 Pro reading $22=35 is offered 353 x 263 while the frame stays 0..358; disjoint boxes keep the frame"},
  {"id":"R6-P3-4","severity":"P3","area":"fix-studio-bed","file":"src/core/scene/retained-source-scale.ts","line":67,"anchor":"The function's own comment","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A fold leaves 120.000002 / 60.000001 in the sketch's parameters"},
  {"id":"R6-P3-5","severity":"P3","area":"fix-studio-bed","file":"scripts/qualify-windows-installer.ps1","line":316,"anchor":"Twin: installed-upgrade-profile.ps1 finally vs Invoke-AssociatedProject","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"A shell-open app ending early keeps no exit code; a close hang keeps no log in either script; no release run has exercised #1525"},
  {"id":"R6-P3-6","severity":"P3","area":"fix-studio-bed","file":"src/ui/design-studio/design-kept-drawings.test.tsx","line":1,"anchor":"METHOD L7; ADR-590 Amd 2 Consequences","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"ADR-590 Amd 2 'Other projects are unchanged' drift; no tests for New, Studio-less files, a new layer, an empty Apply, the cap, or toolbar-precision typing"}
]
```
