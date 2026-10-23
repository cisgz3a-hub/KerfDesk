# Meta audit v1 — M4 Controller v4 P1/P2s (`meta-controller-v4`)

- **When:** 2026-10-23 10:50–11:35 (+08)   **Tree:** origin/main @ `87ecb4f24`. Its `src/` is
  byte-identical to `17f4d6b68` (the #1413 merge; `git diff --stat 17f4d6b68 origin/main -- src` is
  empty). The shared worktree's source stops at merge-base `e660e0e5c`, which lacks #1411, #1412 and
  #1413, so every run used a read-only export of origin/main (`git archive origin/main`) in the
  scratchpad, with a junction to the repo's `node_modules`. Nothing in the shared worktree was
  changed.
- **Scope:** the 13 P1/P2 rows of `docs/audits/2026-10-22-controller-v4/LEDGER.md` (E1-P2-1 and
  E4-P1-1 now P1), plus E5-P2-4 (lowered to P3), so 14 findings. Their reports E1–E6 and fix PRs
  #1399, #1400, #1403, #1410, #1411, #1412 and #1413. E6's clean claim, "no safety or recovery
  decision reads the time estimate".
- **Method:** METHOD.md with the meta changes in AREAS.md. All 14, not a sample.
  - **Genuine?** Pre-fix behaviour was rebuilt by reverting each fix in the export (the PR's
    first-parent file, or a one-line semantic revert where the PR also added exports its tests
    import) and running the fix's own regression test against it. Ground truth was spot-checked
    against freshly fetched sources (below).
  - **Merged?** `gh pr view <n> --json state,mergedAt,mergeCommit`: all seven are MERGED.
  - **Effective?** Each fix's tests pass on origin/main. One or more adjacent variants were tried
    per fix (table below).
  - **Primary sources re-fetched** (copies in the scratchpad `m4-src\`): gnea/grbl `gcode.c` @
    `bfb67f0`; FluidNC v4.0.3 `GCode.cpp` and `SpindleDatatypes.h`; grblHAL core `gcode.c` @
    `4ec1ae44`; Smoothieware `CartGridStrategy.cpp`, `GcodeDispatch.cpp`, `Player.cpp`,
    `Robot.cpp` and `SimpleShell.cpp` @ `91fe4286`.
  - **Test runs:** `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run <file>`
    in the export, one process at a time. Repros were `zz-m4-*` files in the export only; copies
    are in the scratchpad `m4-repros\`.
- **Counts:** 12 meta findings: **P1 2**, P2 0, P3 10. **Refuter (2026-10-23): 10 CONFIRMED, 1
  PLAUSIBLE (M4-P3-7), 1 REFUTED (M4-P3-6, so E4-P2-3 stays P2).** Standing after the refuter:
  P1 2, P2 0, P3 9. The refuter changed none of M4's own ratings.
  - 2 fix gaps that leave the original harm reachable on main (M4-P1-1, M4-P1-2);
  - 6 wrong severities (M4-P3-2 to M4-P3-7), all on defects already fixed or mitigated, so record
    corrections;
  - 1 stale-record umbrella with 9 sub-items (M4-P3-1);
  - 3 small fix gaps or bad claims (M4-P3-8 to M4-P3-10).

  No false positive and no fix that fails in its own scenario. Own candidates dropped: 4 (see
  "Refuted").

## Headline

All 14 controller-v4 P1/P2s were genuine. All seven fix PRs are merged and work on main in the
scenario each finding describes. Twelve of the 14 regression tests were run against the pre-fix code,
and every one of them fails there. Three things are wrong with the record and the ratings.

- **Two harms still reproduce on main by an adjacent path.**
  - **Undo can change the machine mode during a held CNC job (M4-P1-1).** #1399 locks Machine
    Setup's Save during a job, but Ctrl+Z still restores the project from before a Laser→CNC switch.
    The REPRO is a real streamer held at a tool change: after Undo the project is Laser, and **Jog
    to point** sends `$J=G91 G21 X50.000 Y50.000 F1000` with no safe-Z lift and no Work-Z check. In
    CNC mode the same jog is refused until Work Z is set.
  - **grblHAL `G43 H<n>` and `G43.2 H<n>` slip past the Work-Z rule (M4-P1-2).** #1413 voids Work Z
    for `G43.1`, `G49`, `M6` and `T`, but not for these two. grblHAL keeps the tool length offset
    after `M2`/`M30` (`gcode.c` L5026), so the next CNC project Start skips Zero Z and cuts at the
    offset depth. The Console shares the same rule.
- **The §3 consistency pass stopped early.** The M3 follow-on raised E1-P2-1 and E4-P1-1 to P1.
  Five more refuters kept a P1-by-effect finding at P2 for reach alone:
  - E2-P2-2: bit dragged through the stock;
  - E3-P2-2: tile Frame driven 80 mm past the bed;
  - E4-P2-1: silent wrong depth;
  - E4-P2-2: the run reaches 110 mm outside the Frame;
  - E4-P2-3: a promised stop that never happens. (Refuter: not P1. The file's own motion runs
    unchanged, so the output is not wrong. See M4-P3-6.)

  E5-P2-4 was lowered to P3 for reach and an ADR that accepts the cap, but not the false dialog
  sentence, although a catalogue profile (Falcon A1 Pro) reaches it. All six are fixed or mitigated,
  so these are record corrections.
- **The ledger is stale again.** Seven status cells (#1411, #1412, #1413) do not say merged. The
  header, the totals and the E4-P1-1 row text still say "P1 0" and "lowered for reach" beside the
  "(P1)" corrections. E5-P2-4's mitigation in #1411 is not recorded.

E6's clean claim holds on main. Its 12 direct consumers of `gcode-time` and `motion-planner` are the
same files as on the audited tree, neither module has changed since, and every consumer is still a
display or a warning.

## P1/P2 table

**Test adequate:** **R** means the fix's test was run against the pre-fix code and failed; **A**
means the assertion names the reported symptom (read, not run).

| ID | Genuine? | Fix PR (merge) | Merged? | Effective? | Test adequate? | Severity OK? | Ledger status OK? |
|---|---|---|---|---|---|---|---|
| E1-P2-1 (P1) | yes (revert: FluidNC back to version 3 bytes; FluidNC v4.0.3 `SpindleDatatypes.h` L5 `typedef uint32_t SpindleSpeed`) | #1400 `78001392e` | yes 10-22 18:03Z | yes; $30 = 2/99/100/255 checked, a step warning below 100 | **R** (6 of 7 fail) | yes, P1 (justification note in M4-P3-1.08) | yes ("#1400 (merged)") |
| E2-P2-1 | yes (revert of `keepWorkArea`: S30 refilled to 400 × 410) | #1399 `cb9752227` | yes 10-22 17:32Z | yes; the only other detected-settings path (`DetectedSettingsToast`) is an info toast | **R** (3 fail) | defensible (fill card with Undo and the "controller's limit" caveat reaches the operator first) | yes |
| E2-P2-2 | yes (revert of the hook guard: project becomes Laser in the hold) | #1399 | yes | yes for Setup's Save; **gap**: Undo (M4-P1-1) | **R** (hook test fails: `'laser'` vs `'cnc'`) | **no: P1 by effect** (M4-P3-2) | yes |
| E3-P2-1 | yes (pre-fix `external-run.ts:253` `toolChangePause: false`; tiles kept `M0`) | #1403 `427db7e7b` | yes 10-22 18:33Z | yes (one file per bit; the Run review warns on any KerfDesk `M0` bit change, single-file saves too) | A | defensible (Zero Z refused with "Request ABORT" before the cut) | yes |
| E3-P2-2 | yes (revert of `placeCncParks(…, null)`: tiles park at `Y380.000`) | #1403 | yes | yes | **R** (3 fail) | **no: P1 by effect** (M4-P3-3) | yes |
| E4-P1-1 (P1) | yes (pre-fix wiring: store keeps G54) | #1413 `17f4d6b68` | yes 10-23 01:16Z | yes; G56–G59, `g57`, `G90 G59 G0 X1`, G59.1 and a Smoothieware-style `G55 … M30` checked | **R** (2 fail) | yes, P1 | **no** (M4-P3-1.01; row text and totals .08) |
| E4-P2-1 | yes (same revert: Work Z stays current) | #1413 | yes | yes for its four words; **gap**: `G43 H`, `G43.2 H` (M4-P1-2) | **R** (4 fail) | **no: P1 by effect** (M4-P3-4) | **no** (.02) |
| E4-P2-2 | yes (revert: `#1=120` accepted, envelope X ≤ 10) | #1412 `117e8524f` | yes 10-23 00:45Z | yes on FluidNC and grblHAL; behind a GRBL profile only flagged (M4-P3-8) | **R** (12 fail) | **no: P1 by effect** (M4-P3-5) | **no** (.03) |
| E4-P2-3 | yes (revert: "M0 or M1 … holds"; grbl `gcode.c` L251 ignores M1) | #1412 | yes | yes on GRBL, FluidNC and grblHAL (M1 inside a motion block too); Smoothieware unverified | **R** (10 fail) | **no: P1 by effect** (M4-P3-6) | **no** (.04) |
| E4-P2-4 | yes (revert: shell, SD and M28 lines accepted) | #1410 `ca3dbeb79` | yes 10-23 00:11Z | yes; leading space or tab before `reset`, `M28` mid-line, a named `M30` on Smoothieware and Marlin, lowercase Marlin `m28`, `M374.1`; **gap** `M375` (M4-P3-9) | **R** (6 fail) | defensible (security weakness that needs a crafted file; see note under "Severity review") | yes |
| E5-P2-1 | yes (revert: 0.01 accepted, burned at 0.05) | #1411 `48f3d8b5a` | yes 10-23 00:59Z | yes (floor 0.05 shared with the fill engine) | **R** (2 fail) | defensible | **no** (.05) |
| E5-P2-2 | yes (revert: 7 overlap cases) | #1411 | yes | yes | **R** (8 fail) | defensible | **no** (.06) |
| E5-P2-3 | yes (revert: hottest first on rear-right, front-right and centre origins) | #1411 | yes | yes | **R** (6 fail) | defensible | **no** (.07) |
| E5-P2-4 (P3) | yes (the note printed 25 mm "to reach" 20,000 mm/min) | #1411, decision 4 (note names the cap) | yes | mitigated (the note now says faster cells may burn below their label) | A (`MaterialTestDialog.axes.test.tsx` "names the speed a capped runway reaches") | **no: should be P2** (M4-P3-7) | **no** (.09, not recorded) |

## Severity review (METHOD §3 as clarified)

| Finding | Refuter's reason to keep or lower | Verdict |
|---|---|---|
| E1-P2-1 → P1 | (coordinator raise) | Justified, but on the silent under-burn at tops 20–99 (S6.98 → 30% for 34.9%). The ledger's note cites "burning nothing at 60 %", a dark failure that M3 accepted as a P2 reason for C6-P2-1 (M4-P3-1.08) |
| E4-P1-1 → P1 | (coordinator restore) | Justified |
| E2-P2-1 kept P2 | "the fill card does list both changes with Undo, plus a caveat line" (E2:147) | Defensible. A signal reaches the operator before Save, and it names the value as the controller's travel, not a measured work area |
| E2-P2-2 kept P2 | "it needs a deliberate, unusual sequence" (E2:219) | **Reach only.** P1 by effect: the jog moves the bit at depth with no lift and no Work-Z check (M4-P3-2) |
| E3-P2-1 kept P2 | "Zero Z is refused visibly"; routers without cycle start end in Abort (E3:199) | Defensible. A refusal that names Abort reaches the operator before the wrong-depth cut |
| E3-P2-2 kept P2 | Frame-first visibility, two opt-ins, a hand zero away from the bed origin (E3:279) | **Reach, plus a "visibility" that is the harm itself** (M4-P3-3) |
| E4-P2-1 kept P2 | "needs idioms that are rare"; the common `G92` idiom zeroes at the stock top, or the cut is "visibly airborne" (E4:262) | **Reach, plus visibility after the output** (M4-P3-4) |
| E4-P2-2 kept P2 | "Parametric FluidNC files are uncommon, and the review does show a warning, but that warning names neither…" (E4:324) | **Reach.** The refuter itself calls the warning inadequate: it says the lines are "skipped" (M4-P3-5) |
| E4-P2-3 kept P2 | "Reach is limited to files posted with M1" (E4:365) | **Reach only** (M4-P3-6) |
| E4-P2-4 kept P2 | "needs a crafted or unusual file, which is METHOD §3 P2 ('unusual conditions')" (E4:430) | Defensible under the P2 security clause. Note: losing `/sd/config` also meets the P1 clause "loses or corrupts user data", and §3 does not say which clause wins when a security weakness destroys data. Left to the coordinator, not raised |
| E5-P2-1/2/3 kept P2 | No later job burns differently (P2-1); the garble is visible (P2-2); every cell gets its labelled energy (P2-3) | Defensible: output not wrong, or a visible defect |
| E5-P2-4 lowered to P3 | The ADR accepts the cap; the default profile cannot reach it; M4 keeps the energy right (E5:309-353) | **Not supported** (M4-P3-7) |

## Findings

### M4-P1-1 — Fix gap (E2-P2-2 / #1399): Undo during a held CNC job switches the project to Laser, and Jog to point then drags the bit with no safe-Z lift and no Work-Z check
- **Corrects:** E2-P2-2 "fixed by #1399". ADR-416 Amendment 1, Consequences: "A held CNC job keeps
  its mode, its safe-Z lift and its Work-Z check through a bit change, whatever is done in Machine
  Setup."
- **Kind:** Fix ineffective (adjacent path).
- **Where:**
  - `src/ui/state/store-actions.ts:149-180` (`undo`) restores `project: prev` with no job check.
    `redo` (`:185-200`) mirrors it.
  - `src/ui/state/machine-actions.ts:123-170`: `setMachineKind` pushes the mode switch onto the undo
    stack. ADR-416 line 64 makes "Undo and Redo of a mode toggle" a supported operation.
  - The lock lives only in controls: `MachineModeToggle.tsx:26-35`, whose comment says a switch at
    a CNC bit change "would let the bit travel through the stock", and `use-machine-setup-save.ts:43-46`.
  - `src/ui/app/use-shortcuts.ts:50` → `shortcut-contexts.ts:69` invokes Undo whenever no modal owns
    the keyboard (`keyboard-owner.ts:6-8`). The tool-change hold is not a modal.
  - Consequence: `src/ui/state/laser-jog-actions.ts:383-403` (`retractToCncSafeZ`) and `:405`
    (`assertCncPointMoveWorkZReady`) both read the live project mode.
- **Anchor:**
  - Contract: ADR-416 decision 1, whose context is that a live toggle during a job lost the CNC
    tool-change jog's safe-Z lift.
  - Contract: ADR-416 Amendment 1, quoted above.
  - Twin: the toolbar lock and Setup's lock against Undo.
- **Scenario:**
  1. The operator switches the toolbar to CNC and starts a two-bit job. With no edit since, the
     switch is the newest undo step.
  2. The job holds at the bit change.
  3. Ctrl+Z (or Edit > Undo) restores the Laser project. The toolbar now reads Laser, and nothing
     warns.
  4. Jog to point moves the bit in XY at cutting depth, through the stock or a clamp. The Work-Z
     check, which refuses the same move in CNC mode, is skipped too.
- **Evidence:** REPRO. `zz-m4-undo-during-hold.test.ts` reuses the `laser-tool-change-jog.test.ts`
  harness: a GRBL 1.1 stand-in and a real `startJob` drained into the `tool-change` hold.
  - `M4 undo-in-hold: status tool-change active true mode before undo cnc after undo laser jogError none jog writes ["$J=G91 G21 X50.000 Y50.000 F1000\n"]`
  - Control, the same hold with no Undo: `M4 control: mode cnc jogError CNC point move blocked: set or probe Work Z before moving. … jog writes []`
  - READ: drag-and-drop opening and snapshot restore check `isActiveJob`
    (`dropped-project-open.ts:24`, `restore-local-snapshot.ts:76`). Ctrl+O was not checked (see
    "Not verified").
- **Severity:** P1 by effect under §3: the machine moves unexpectedly, a bit dragged through the
  stock or clamps, with no warning. The REPRO shows the same harm that E2-P2-2 and ADR-416's context
  name. Reach (the switch must be the newest undo step, or the operator presses Undo several times)
  does not lower a P1 (§3 clarification). If the coordinator keeps E2-P2-2 at P2 (M4-P3-2), this
  gap takes the same rating.
- **Refuter (2026-10-23, fresh context):** **CONFIRMED (REPRO), P1 kept.**
  - **Own REPRO.** Ran on a detached origin/main worktree (`87ecb4f24`), now removed, with M4's
    harness: a GRBL 1.1 stand-in and a real `startJob` drained into the `tool-change` hold.
    - A, M4's case: `status tool-change active true undoLen 1 mode laser`. The point jog sent
      `["$J=G91 G21 X50.000 Y50.000 F1000\n"]`.
    - B, touch-off first (Work-Z evidence current), then Undo: the same single XY jog.
    - Control B, the same touch-off with no Undo:
      `["$J=G90 G21 Z3.810 F1000\n","G4 P0.01\n","$J=G91 G21 X50.000 Y50.000 F1000\n"]`.
    - Redo switches the project back to CNC in the middle of the hold.
    - C: with one edit after the switch, the first Undo keeps CNC and the second gives Laser.
      This only limits reach.
  - **No guard upstream.**
    - `historyActions` (`store-actions.ts:147-210`) has no job check.
    - `shortcut-contexts.ts:69` and `use-app-commands.ts:253-256` gate Undo only on stack length.
    - No store subscriber watches the machine kind during a job, and Undo shows no toast.
    - Point moves stay open in a drained hold through `dispatchPositionLaser`, `dispatchHeadMove`
      and OriginRow. Each checks only `jogFrameCommandBlockMessage`.
  - **Continue is not affected.** `toolChangeContinueBlockMessage` (`laser-store-helpers.ts:132-158`)
    requires Work Z in either mode, so the harm is the point jog only.
  - **Wording correction.** The emitter retracts and parks before the `M0`
    (`cnc-grbl-transitions.ts:90-101`), so the bit is at park height when the hold starts, not "at
    cutting depth". The drag happens at the touch-off height, the stock top, after the operator
    lowers Z to Zero Z, as the hold asks (case B). Clamps stand above that height.
  - **Anchor.** ADR-416 Amd 1's Consequences sentence covers Machine Setup only. The contract is
    ADR-416 decision 1 and its Context, which names this harm.
  - **Severity.** P1 by effect: KerfDesk's own jog moves the bit at clamp height with no lift, and
    no warning comes first. The toolbar label changing is not a warning. Rated the same as E2-P2-2
    (M4-P3-2, confirmed).
- **Fix direction:**
  - Refuse Undo and Redo while `isActiveJob`, when the restored project changes the machine kind,
    the CNC machine config or the device. Use `MODE_LOCKED_DURING_JOB`'s wording.
  - Or, more generally, guard every project replacement in one place the laser store can reach, for
    example a subscriber.
  - Add a store-level test: Undo of a mode switch during a `tool-change` hold leaves the mode
    unchanged.

### M4-P1-2 — Fix gap (E4-P2-1 / #1413): grblHAL `G43 H<n>` and `G43.2 H<n>` in an opened program leave the tool length offset applied and Work Z "current"; the next CNC Start skips Zero Z
- **Corrects:** E4-P2-1 "fixed by #1413". ADR-630 Amendment 6 decision 3 says "Work Z follows the
  Console's rule". The Console's rule has the same hole.
- **Kind:** Fix ineffective (adjacent words).
- **Where:**
  - `src/core/controllers/console-state-effect.ts:24`: `TOOL_COMMAND_RE` matches
    `G43\.1|49|M0?6|T…` only, so `G43` and `G43.2` classify as `machine-state`.
  - `src/ui/state/external-program-controller-state.ts:36-41,62-63` keeps only `coordinates-z`,
    `coordinates-all` and `tool`.
  - `src/ui/state/laser-console-actions.ts:340-346`: the Console applies the same classification.
- **Anchor:**
  - Ground truth: grblHAL core `gcode.c` @ `4ec1ae44`:
    - L1670-1683: `G43` and `G43.2` set `ToolLengthOffset_Enable` or `ApplyAdditional` when the
      tool table has tools.
    - L2944-2967: `G43` applies the tool table entry named by `H`, and `G43.2` adds one.
    - L5023-5026: at program end the remaining modal groups, including "[G-code … 8 …]" (tool
      length offset), "do not reset".
  - Twin: `G43.1` gets the void and these do not; the external effect lies with the Console.
- **Scenario:**
  1. On grblHAL with a tool table, the operator probes Z and runs an opened file that applies a
     stored offset with `G43 H2`. The file has no `T`, `M6`, `G43.1` or `G92 Z` word anywhere.
     The classification is per file, so any such word would void Work Z.
  2. The TLO stays after `M30`.
  3. The next KerfDesk CNC project Start finds the probe evidence current and asks for no Zero Z.
     KerfDesk's CNC preamble writes no `G49` (`cnc-grbl-transitions.ts`, `cnc-grbl-strategy.ts`:
     no match), so every Z is shifted by tool 2's table offset, deeper or shallower.
  4. The Run review names no persisting offset. For this file it showed only "zero XY extent" and
     "never moves Z" notes (`zz-m4-g43-review.test.ts`).
- **Evidence:** REPRO (unit) + SOURCE. `zz-m4-wcs-variants.test.ts`:
  - `M4 unit G43 H1: {"selectsOtherWcs":false,"changesWorkZ":false}`
  - `M4 unit G43.2 H2: {"selectsOtherWcs":false,"changesWorkZ":false}`
  - control `M4 unit T1 then G43 H1: {…"changesWorkZ":true}`

  The GRBL simulator rejects `G43`, so no store-level run was possible; the patch function is the
  only gate.
- **Severity:** P1 by effect (silent wrong depth), as E4-P2-1 itself (M4-P3-4). Reach is narrow: a
  grblHAL build with a tool table, and a file with `G43 H` but no tool word. §3 does not lower a P1
  for reach. If the coordinator keeps E4-P2-1 at P2, this takes P2.
- **Refuter (2026-10-23):** **CONFIRMED (REPRO + SOURCE), P1 kept.**
  - **Firmware.** grblHAL core `gcode.c` @ `4ec1ae44`, fetched again:
    - L1670-1683: `G43` and `G43.2` are accepted only when `grbl.tool_table.n_tools` is non-zero.
      Otherwise the controller answers `Status_GcodeUnsupportedCommand`.
    - L2944-2967: the `H` lookup.
    - L5023-5026: group 8 and the `H` word are not reset at `M2`/`M30`.
    - `gc_init` (L762-805): at compatibility level 1 or below, a warm reset copies
      `tool_length_offset` back, so even a reset does not clear the offset.
  - **Own REPRO on main.**
    - `commonConsoleStateEffect` returns `machine-state` for `G43 H2`, `G43H2`, `G43.2 H2`,
      `G43 H0` and `G43`. It returns `tool` for `G43.1 Z2`, `G49`, `T2 M6` and `G43 H2 T2`.
    - A realistic file (`G54 / S12000 M3 / G43 H2 / … G1 Z-2 … / M30`) gives
      `changesWorkZ:false`.
    - The grblhal Run review sends that file with `warnings []`. Under grbl-v1.1 it flags the line
      "Stock GRBL rejects this whole block: G43 is unsupported".
  - **Code.** The patch's only caller is `laser-job-actions.ts:430`. `src/core/output` and
    `src/core/cnc` emit no `G49`, and nothing in `src` parses `TLO` or the `$G` G43 mode.
  - **Reach is narrow.**
    - `N_TOOLS` defaults to 0 and exists only at `COMPATIBILITY_LEVEL == 0` (`config.h` L542-549).
      Otherwise a plugin must register a tool table.
    - Without a table, `G43` errors and stops the program, so nothing persists.
    - CAM posts for tool-table machines normally write `T`/`M6` beside `G43 H`, and the per-file
      classification already catches those. The gap needs a file with `G43 H` and no tool word.
  - **Severity.** §3 counts an unusual firmware build as reach, which cannot lower a P1. P1, the
    same as E4-P2-1 (M4-P3-4, confirmed).
- **Fix direction:** Add `G43` (with or without `H`) and `G43.2` to `TOOL_COMMAND_RE`, so the
  Console and an opened program void Work Z for them. Add them to
  `external-program-controller-state.test.ts` and the simulator list.

### M4-P3-1 — Stale record: the controller-v4 ledger lags GitHub and its own corrections
- **Corrects:** `docs/audits/2026-10-22-controller-v4/LEDGER.md` (worktree version at `3f5a0997b`).
- **Kind:** Stale record (plus one contradiction in a correction note).
- **Where / Scenario:**

| Sub-id | Row / place | Ledger says | GitHub / fact |
|---|---|---|---|
| .01 | E4-P1-1 status | `#1413` | merged `17f4d6b68`, 2026-10-23 01:16Z, before the M3 edit at 03:04Z, which left it unchanged |
| .02 | E4-P2-1 status | `#1413` | same merge |
| .03 | E4-P2-2 status | `#1412` | merged `117e8524f`, 00:45Z |
| .04 | E4-P2-3 status | `#1412` | same merge |
| .05 | E5-P2-1 status | `#1411` | merged `48f3d8b5a`, 00:59Z |
| .06 | E5-P2-2 status | `#1411` | same merge |
| .07 | E5-P2-3 status | `#1411` | same merge |
| .08 | Header rows E1 ("P1 0 / P2 1") and E4 ("0 (P1-1 lowered) / 5"); totals ("P1 0, P2 13 … E4-P1-1 lowered to P2 (reach)"); the E4-P1-1 row text ("Lowered from P1 for reach"); the E1-P2-1 correction note ("FluidNC burning nothing at 60 %", in the meta LEDGER's M3 follow-on) | as quoted | Two rows now read "(P1)", so the counts should be P1 2 / P2 11. E1-P2-1's P1 basis is the silent under-burn at tops 20–99, not the dark `$30=1` case |
| .09 | E5-P2-4 (P3, not in the table) | "P2-4 lowered" only | #1411 took it: ADR-497 Amendment 1 decision 4, the capped-runway note |

- **Evidence:** SOURCE (`gh pr view 1411/1412/1413 --json state,mergedAt,mergeCommit`) and
  `git log -- LEDGER.md` (commits 01:48, 08:29 and 11:04 +08).
- **Refuter (2026-10-23):** **CONFIRMED (SOURCE + READ), all nine sub-items.**
  - `gh pr view` today:
    - #1411: MERGED 00:59:16Z, `48f3d8b5a`.
    - #1412: MERGED 00:45:22Z, `117e8524f`.
    - #1413: MERGED 01:16:34Z, `17f4d6b68`.
  - **Spot checks .01, .03 and .05.** Ledger L25, L27 and L30 show a bare "#1413", "#1412" and
    "#1411". The other four status cells (L26, L28, L31, L32) read the same way.
  - **.08.** The header (L7, L10), the totals (L14) and the E4-P1-1 row text (L25) read as quoted.
    M3 accepted a dark failure as a P2 reason for C6-P2-1 (its P1/P2 table), so the under-burn
    basis is the right one.
  - **.09.** ADR-497 Amendment 1's Status line and its decision 4 take E5-P2-4.
- **Fix direction:** Mark the seven rows "(merged)". Recount the header and totals. Strike "Lowered
  from P1 for reach" from the E4-P1-1 row. Note E5-P2-4 → #1411. Reword the E1-P2-1 basis.

### M4-P3-2 — Wrong severity (E2-P2-2): kept at P2 because the sequence is "deliberate, unusual"; P1 by effect
- **Corrects:** E2-P2-2 severity; fixed by #1399 for Setup's Save (gap: M4-P1-1).
- **Kind:** Wrong severity.
- **Where:** `E2-ctl-machine-setup-flow.md:219-222`.
- **Anchor:** §3 P1, "move the machine unexpectedly". The clarification says reach never lowers a
  P1.
- **Scenario:** as raised. In the refuter's own REPRO, the point jog sent only the XY move, while
  CNC mode lifts first. The refuter's "Why not P3" calls it "a clear physical failure (bit dragged
  through the stock or clamps)". No warning appears: "no replace notice appeared".
- **Evidence:** READ of the report's reasoning; M4-P1-1's REPRO shows the same jog output.
- **Severity of this meta finding:** P3, a record correction.
- **Refuter (2026-10-23):** **CONFIRMED.**
  - E2:219-222 gives reach ("deliberate, unusual sequence") as its only reason. E2's own "Why not
    P3" names the physical failure.
  - The M4-P1-1 refuter REPRO (case B) shows the drag after touch-off.
  - Here the operator picks Laser on purpose, but nothing says the lift depends on the mode, and
    ADR-416's Context names this harm.
  - P1 by effect.
- **Fix direction:** Record E2-P2-2 as "P1 by effect (meta-v1 M4)".

### M4-P3-3 — Wrong severity (E3-P2-2): the tile park's 80 mm overrun happens during the Frame on stock GRBL defaults; P1 by effect
- **Corrects:** E3-P2-2 severity; fixed by #1403.
- **Kind:** Wrong severity.
- **Where:** `E3-ctl-cnc-routines.md:257-281`.
- **Anchor:** §3 P1, "move the machine unexpectedly" and "silently produces wrong … position".
- **Scenario:** In the refuter's own analysis, with no homing and soft limits off (stock GRBL
  defaults), the review only says it cannot place the outline. The Frame then drives to bed Y480 on
  a 400 mm bed and loses steps. "GRBL still reports the Frame complete", and the whole tile is
  shifted. The refuter's three reasons:
  - two opt-ins: reach;
  - a hand zero away from bed (0, 0): reach, and the normal F-CNC19 workflow;
  - "Frame-first makes it visible": the Frame is the motion that crashes, so nothing warns before
    it.
- **Evidence:** READ of the refuter's own "Mitigation, not a refutation" paragraph. The fix's test,
  run against the reverted code, prints `Y380.000` in both tiles.
- **Severity of this meta finding:** P3, a record correction.
- **Refuter (2026-10-23):** **CONFIRMED.**
  - E3:257-281 says what M4 quotes. On stock defaults the review says only that it cannot place
    the outline. The Frame then drives to bed Y480, and GRBL reports the Frame complete.
  - "Frame-first makes it visible" fails the §3 test, because the Frame is the motion that
    overruns.
  - The two opt-ins and the hand zero are reach.
  - P1 by effect.
- **Fix direction:** Record E3-P2-2 as "P1 by effect (meta-v1 M4)".

### M4-P3-4 — Wrong severity (E4-P2-1): silent wrong depth kept at P2 for rare idioms; P1 by effect
- **Corrects:** E4-P2-1 severity; fixed by #1413 (gap: M4-P1-2).
- **Kind:** Wrong severity.
- **Where:** `E4-ctl-external-normalize.md:262-264`.
- **Anchor:** §3 P1, "silently produces wrong physical output (… depth …)".
- **Scenario:** the cases and the refuter's reasons:
  - `G43.1`, `G10 L20 Z` and grblHAL `M6 T` with a TLO cut at a shifted depth with no warning.
  - "Idioms that are rare" is reach.
  - "The common `G92 X0 Y0 Z0` usually zeroes at the stock top" holds for that one idiom only.
  - "Visibly airborne" is seen during the cut, not warned before it.

  E4-P1-1, with the same "external program leaves controller state" mechanism, is now P1.
- **Evidence:** READ; the revert run shows Work Z still current after each of the four words.
- **Severity of this meta finding:** P3, a record correction.
- **Refuter (2026-10-23):** **CONFIRMED.**
  - E4:262-264's reasons are reach and an airborne cut that is seen only during the run.
  - The airborne direction alone is a dark failure, which is P2 by M3's precedent for C6-P2-1.
  - `G43.1 Z-3` and `M6 T` with a TLO cut deeper, with no warning.
  - P1 by effect.
- **Fix direction:** Record E4-P2-1 as "P1 by effect (meta-v1 M4)".

### M4-P3-5 — Wrong severity (E4-P2-2): the run reaches 110 mm outside the Frame while the review says the lines were "skipped"; P1 by effect
- **Corrects:** E4-P2-2 severity; fixed by #1412.
- **Kind:** Wrong severity.
- **Where:** `E4-ctl-external-normalize.md:324-326`.
- **Anchor:** §3 P1, "silently produces wrong … position". NN21 and ADR-565 make the Frame the
  spatial truth, and E4-P1-1 (Frame in one system, cut in another) is P1 on the same basis.
- **Scenario:** The Frame traces X 0..10 and FluidNC drives to X120. The only warning, "Unreadable
  lines … were skipped", tells the operator those lines will not run, which is the opposite of what
  happens. The refuter's reasons are reach ("uncommon") and that warning, which the refuter itself
  calls inadequate.
- **Evidence:** READ; the revert run shows `#1=120` accepted with envelope maxX 10.
- **Severity of this meta finding:** P3, a record correction.
- **Refuter (2026-10-23):** **CONFIRMED.**
  - The Frame is KerfDesk's proof of position. E4-P1-1, where the Frame and the cut land in
    different places, is P1 on the same basis.
  - The bed and keep-out checks read the same short envelope.
  - The "were skipped" warning says the opposite of what runs, so it is not a clear warning.
  - P1 by effect.
- **Fix direction:** Record E4-P2-2 as "P1 by effect (meta-v1 M4)".

### M4-P3-6 — Wrong severity (E4-P2-3): a stop KerfDesk promised never happens; kept at P2 for reach only
- **Corrects:** E4-P2-3 severity; fixed by #1412.
- **Kind:** Wrong severity.
- **Where:** `E4-ctl-external-normalize.md:365-366` ("Reach is limited to files posted with M1").
- **Anchor:** §3 P1, "move the machine unexpectedly". The review told the operator that the
  controller "holds there until the machine's own cycle start", and stock GRBL and FluidNC run
  straight on (gnea/grbl `gcode.c` L251 `case 1: break; // Optional stop not supported. Ignore.`;
  FluidNC v4.0.3 `GCode.cpp` L633-635, both re-fetched).
- **Scenario:** as raised: the operator waits at the promised stop to move a clamp, and the bit
  runs into it.
- **Evidence:** SOURCE + READ.
- **Severity of this meta finding:** P3, a record correction.
- **Refuter (2026-10-23):** **REFUTED. E4-P2-3 stays P2.**
  - **The output is not wrong.** KerfDesk sends the file unchanged, and the controller makes exactly
    the moves the file commands. Nothing moves that the operator did not start, and no power,
    position, depth or scale is wrong.
  - **What fails is a pause.** `M1` is an optional stop by definition: LinuxCNC and Mach honour it
    only with the optional-stop switch on.
  - **Severity.** The harm is a false review sentence that an operator may rely on. That is P2's
    "wrong behaviour … with a misleading result". It meets §3's lowering test ("the output is not
    wrong").
  - **Contrast.** This differs from M4-P3-5, where KerfDesk's own Frame shows the wrong place.
  - **Sources.** The firmware lines M4 cites are right: grbl L251, FluidNC v4.0.3 L633-635.
- **Fix direction:** Record E4-P2-3 as "P1 by effect (meta-v1 M4)".

### M4-P3-7 — Wrong severity (E5-P2-4): lowered to P3 for reach and an ADR that accepts the cap, not the false sentence; should have stayed at least P2
- **Corrects:** E5-P2-4's lowering to P3. Mitigated since by #1411 decision 4.
- **Kind:** Wrong severity.
- **Where:** `E5-ctl-material-tests.md:309-353`; ADR-497 decision 6.
- **Anchor:** the §3 clarification: "Reach can only lower a finding to P3, and only when the defect
  is not reachable today."
- **Scenario and reasons:**
  - **Reachable today.** The catalogue's Falcon A1 Pro profile (max feed 36,000, starter accel 500)
    reaches it. A user-raised max feed is not needed.
  - **The ADR does not cover the defect.** ADR-238 Amd 3 and ADR-495 accept the 25 mm cap. They do
    not accept a dialog that says the 25 mm "reach[es] 20,000 mm/min". ADR-497 decision 6 itself
    promises "the whole run-up its fastest cell needs … Shorter is never used". The refuter read
    "shorter" as being about the stored 5 mm only, but the sentence compares against "whichever is
    longer".
  - **"Edges burn as the operator's jobs will" is literal.** A 5 mm cell is all edge, and a job's
    long lines reach the label speed after the runway. On constant power (GRBL Constant, Marlin
    inline) a cell therefore carries 1.3–2.1× the labelled energy per mm, and the operator calibrates
    too low. Only M4 keeps the energy right, which is a valid "output not wrong" for M4 alone.
  - That is a misleading result an ordinary Falcon user hits: P2 at least, with a P1 argument for
    the constant-power case.
- **Evidence:** READ of the report, ADR-497 L39-43 and #1411's note text
  (`MaterialTestDialog.axes.test.tsx:108-116`).
- **Severity of this meta finding:** P3. #1411 now discloses the cap before the burn, which §3
  accepts as a clear warning, so this is a record correction.
- **Refuter (2026-10-23):** **PLAUSIBLE. P2 is defensible, but not on the stated Falcon basis.**
  - **What holds.**
    - On main, the Falcon A1 Pro profile has `maxFeed: 36000` and inherits
      `accelMmPerSec2: 500` (`falcon-profiles.ts:42`, `device-profile.ts:412`). Rows above about
      9,045 mm/min therefore hit the cap and the false note.
    - ADR-497 D6 says "whichever is longer. Shorter is never used" and "The dialog says so", so no
      ADR accepts the false sentence.
  - **What is overstated.**
    - The original refuter did not lower for reach alone: it listed the Falcon as reaching the cap.
    - The Falcon profile emits M4 (`grbl-dynamic`), so the burned energy per mm still follows the
      label. Its 500 mm/s² is a starter value, not a measured one.
    - So an ordinary Falcon user sees a false sentence, not a misleading burn.
  - **The P1 argument is weak.** The constant-power miscalibration needs a custom profile. The
    cell's motion is the ADR-238 Amd 3 cap that every fill shares.
  - **Severity.** P2 rests on "a broken contract with a clear failure scenario": D6, plus the
    constant-power case.
- **Fix direction:** Record E5-P2-4 as P2 (meta-v1 M4), "mitigated by #1411 decision 4".

### M4-P3-8 — Fix gap and bad claim (E4-P2-2 and E4-P2-4 / #1412, #1410): behind a GRBL profile, a FluidNC or grblHAL board's expressions and macros are reviewed as stock-GRBL errors; the identity warning ADR-630 Amd 7 relies on is not shown in the Run review
- **Corrects:** ADR-630 Amendment 7: "A board running FluidNC under a GRBL profile is left to the
  existing controller-identity warning."
- **Kind:** Bad citation (claim about another component) + fix gap.
- **Where:**
  - `use-external-program.ts:46-47`: the normaliser and the review take `activeControllerKind`,
    which Connect binds from the profile.
  - `controller-identity-warnings.ts:41-90` feeds Job Review and `start-job-readiness.ts:382` only.
  - `external-run-readiness.ts:26-44` gives the Run review `runControllerReadiness`, which has no
    identity check.
- **Scenario:**
  - A FluidNC board under a GRBL profile opens `#1=120 / G1 X#1`. The file is accepted, and the
    review says "Stock GRBL rejects this whole block … an error stops the job". FluidNC runs it to
    X120.
  - `G65 P100` and `M98 P100` under a GRBL profile (an Ortur ESP32-S2 grblHAL board, M3-P3-3) are
    sent too. A grblHAL build with macros runs them.
- **Evidence:** REPRO (`zz-m4-expr-stop-variants.test.ts`: `grbl profile, # param: SENT … WARNINGS ["Line 3: Stock GRBL rejects this whole block …"]`;
  `zz-m4-storage-variants.test.ts`: `grbl-v1.1 "G0 X0\nG65 P100\n": SENT`) + READ.
- **Severity:** P3. The line is flagged before the run (the stock-GRBL text predicts an error stop),
  so the operator is warned about that line, although the prediction is wrong.
- **Refuter (2026-10-23):** **CONFIRMED (READ on main, plus M4's REPRO).**
  - `use-external-program.ts:45-46` normalises with `activeControllerKind`.
  - `controllerIdentityWarnings` is read only by `start-job-readiness.ts:382`,
    `liveControllerIdentityWarnings` and Job Review.
  - `external-run-readiness.ts:26-44` uses `detectedControllerKind ?? activeControllerKind`, but
    for the settings checks only.
  - The ADR-630 Amd 7 sentence is at L53-54.
  - P3 kept.
- **Fix direction:** Run the evaluated-syntax and storage refusals on the detected kind as well as
  the active one (`detectedControllerKind ?? activeControllerKind`, as `external-run-readiness.ts`
  already does), or show `controllerIdentityWarnings` in the Run review. Correct the ADR sentence.

### M4-P3-9 — Fix gap (E4-P2-4 / #1410): Smoothieware `M375` loads a stored levelling grid from the SD card and turns Z compensation on; not refused
- **Corrects:** #1410's rule (ADR-630 Amd 5): lines that run "what the file does not hold" from the
  controller's files are refused, as `M501` already is.
- **Kind:** Fix gap.
- **Where:** `src/core/external-program/storage-command-check.ts:43-54` (`SMOOTHIE_M_CODES` has
  374, not 375).
- **Anchor:** Smoothieware `CartGridStrategy.cpp` @ `91fe4286` L77 "M375 Load the grid from
  /sd/cartesian.grid and enable compensation", and L454-464.
- **Scenario:** An opened Smoothieware program with `M375` is sent unchanged. Every later Z then
  follows a stored grid that neither the file nor the Frame shows: a focus shift on a laser, a depth
  change on a CNC.
- **Evidence:** REPRO (`zz-m4-storage-variants.test.ts`: `smoothieware "G0 X0\nM375\n": SENT …M375`) + SOURCE.
- **Severity:** P3. It needs a Smoothieware config with grid levelling, and the program asked for
  it.
- **Refuter (2026-10-23):** **CONFIRMED (SOURCE + READ).**
  - Smoothieware `CartGridStrategy.cpp` @ `91fe4286`, fetched again:
    - L77: "M375 Load the grid from /sd/cartesian.grid and enable compensation".
    - L454-464: `load_grid`, then `setAdjustFunction(true)`.
  - On main, `SMOOTHIE_M_CODES` lists 374 but not 375.
  - **Attribution note.** "what the file does not hold" is the code comment at
    `normalize-external-program.ts:263`, not ADR-630 Amd 5. The ADR's rule is "a line the
    controller would hand to its shell, its files or a stored program". M375 fits either one.
  - P3 kept.
- **Fix direction:** Add `M375` (load grid) to `SMOOTHIE_M_CODES` with the same refusal wording,
  or name it in the review.

### M4-P3-10 — Bad claim (E4-P2-1 / ADR-630 Amd 6 "Not in this decision"): the Run review does not warn that a `G92` shift outlasts the program; Marlin's host-recorded shift is not addressed
- **Corrects:** ADR-630 Amendment 6, "Not in this decision": the XY origin record after a program's
  `G92 X Y` or `G10 L2/L20 X Y` is left because "The Run review already warns that later jobs start
  from the changed origin."
- **Kind:** Bad citation.
- **Where:** `external-program-review.ts:93` (the `G92` text names only "Moves after it … not in the
  Frame outline") against `:290` (only `G10 L…` says "Later jobs also start from the changed
  origin"). E4-P2-1's Marlin step (`host-recorded-origin.ts:30-46`, PLAUSIBLE) is not mentioned.
- **Scenario:** A program's `G92 X10 Y10` persists on GRBL until reset (`gcode.c`), and the review
  never says so. Frame-first keeps the next project's Frame and cut consistent. On Marlin,
  `wcoCache` and the host shift go stale (READ).
- **Evidence:** READ.
- **Severity:** P3. The ADR's reason is wrong. The harm is bounded by Frame-first.
- **Refuter (2026-10-23):** **CONFIRMED (READ).**
  - On main, the `G92` warning (`external-program-review.ts:91-94`) says only that later moves are
    not in the Frame outline.
  - Only the `G10 L…` text (:289-291) says "Later jobs also start from the changed origin".
  - ADR-630 Amd 6 L62-63 claims the review warns for both.
  - P3 kept.
- **Fix direction:** Add "the shift stays after the program" to the `G92` warning, or narrow the
  ADR sentence to `G10`. Decide the Marlin host-shift case.

## Test truth (fix-reverted runs)

All runs were in the origin/main export, with the fix reverted in the export only and restored
after each run.

| Fix | Revert | Test | Result |
|---|---|---|---|
| #1400 | `powerScaleVersionForDevice`: FluidNC returns `version` | `fluidnc-whole-number-power.test.ts` | 6 of 7 fail |
| #1399 (E2-P2-1) | drop `keepWorkArea` from the fill | `device-setup-auto-fill.test.ts`, `DeviceSetupWizard.detected-values.test.tsx` | 3 fail (`bedWidth: 380` expected) |
| #1399 (E2-P2-2) | `onSave` job guard disabled | `DeviceSetupWizard.job-lock.test.tsx` | 1 fail (`'laser'` vs `'cnc'`); the rendered-disable case passes, as it should |
| #1403 (E3-P2-2) | `tileLocalJob` without `placeCncParks` | `tiled-bit-files.test.ts`, `tile-bit-files.test.ts` | 3 fail (`Y380.000` present) |
| #1410 | `normalize-external-program.ts` at `ca3dbeb79^1` | `normalize-external-program.test.ts`, `RunGcodeFileDialog.test.tsx` | 6 #1410 cases fail (plus 1 #1412 case) |
| #1412 | `normalize-external-program.ts`, `external-program-review.ts` at `117e8524f^1` | `evaluated-syntax.test.ts`, `program-stops.test.ts` | 22 fail |
| #1411 | 11 production files at `48f3d8b5a^1` | `material-test-emitted.test.ts`, `material-test-label-bounds.test.ts` | 16 of 18 fail |
| #1413 | `external-run.ts`, `laser-job-actions.ts`, `laser-job-options.ts` at `17f4d6b68^1` | `external-run-controller-state.simulator.test.ts` | 6 of 8 fail |

Gaps in the tests: #1399 pins the lock only on the save hook, so nothing pins "the mode cannot
change mid-job" at the store, which is how Undo slips through (M4-P1-1). #1413's word list omits
`G43` and `G43.2` (M4-P1-2).

## Refuted (own candidates, dropped)

- **M4-P3-6, refuted by the refuter (2026-10-23).** E4-P2-3 stays P2. `M1` being ignored
  changes no motion: the file's own moves run unchanged. The defect is a false review sentence
  about an optional pause. Do not raise it to P1 again on "move the machine unexpectedly" alone.

- **Frame WCS selection skipped on network links.** `normalizeFrameWorkCoordinateSystem` returns
  early unless `capabilities.transport === 'serial'`. Every GRBL-family, Marlin and Smoothieware
  driver declares `'serial'`; only Ruida is `'file-only'`. So #1413 holds on Telnet and WebSocket
  links too.
- **Hosted-refill streams hiding later G55 lines from #1413's scan.** `installInitialStream` gets
  the full `gcode` string that `startJob` received (`laser-job-actions.ts:123-158`, `:391-430`).
- **A second automatic `$130`/`$131` path outside Machine Setup.** `DetectedSettingsToast` only
  pushes an info toast and applies nothing.
- **Marlin M0/M1 promised as a hold.** The Marlin reader names both as "unsupported by this preview
  or depends on firmware options", and no hold text appears (`zz-m4-expr-stop-variants.test.ts`).

## Verified clean

- **E6, "no safety or recovery decision reads the time estimate", holds on origin/main.**
  - The non-test importers of `core/gcode-time` and `core/motion-planner` are the same 12 files on
    `71ff820ce` and on main (`time-consumers-*.txt` in `m4-repros\`).
  - No commit has touched either module or `estimate-duration.ts` since 2026-10-22 14:00.
  - The only later commit to a consumer (`c0c0e4350`) passes `controllerKind` into the Inspector's
    planner size, which is display only.
  - `stream-throughput-warnings.ts` still says "Warnings only … none of these can refuse a Start".
  - The watchdogs use their own `programmedDwellSeconds` (`laser-stream-dwell.ts`), not the
    estimate.
  - The newer timers since E6 (the Falcon dot's 30 s auto-off in #1386, the link-loss planner
    step-back in #1366 and #1397) import neither module.
- **#1413 variants.** G56, G57, G58, G59, lowercase `g57` and `G90 G59 G0 X1` all leave the store
  unknown. The next Frame reads `$G`, warns "Controller was using G5x" and selects G54. Unit checks:
  `G55 … M30` (Smoothieware outside grbl mode) and `G59.1` drop the WCS; a commented `(G55)`
  changes nothing; `G92 X0 Y0` and `G10 L2 P1 X5` keep Work Z, as ADR-630 Amd 6 decision 3 says.
- **#1400 variants.** `$30=99`: whole S, at most 0.5 % from the set power, with the step warning.
  `$30=100`: exact whole percentages, no warning. `$30=255`: bytes unchanged. `$30=2`: 50 % steps,
  with the warning that every power below 25 % sends S0.
- **#1410 variants.** All refused: a leading space or tab before `reset`, `M28` after a motion on
  one line, a named `M30` (Smoothieware and Marlin), lowercase Marlin `m28`, `M374.1`. A bare `M30`
  is still sent as the program end.
- **#1412 variants.** Refused on FluidNC: `F[100*2]` and `O100 call`. `M1` inside a motion block
  gets the "ignores" warning. On grblHAL, M1 keeps the hold text plus the optional-stop note.
- **Primary sources** re-fetched, and they say what the reports say:
  - FluidNC v4.0.3 `SpindleDatatypes.h` L5, `GCode.cpp` L313-327 (`#` assignment, O-word flow) and
    L633-635 (M1 not supported);
  - gnea/grbl `gcode.c` L251;
  - grblHAL `gcode.c` L1670-1690 and L5023-5026.

## Not verified

- **Smoothieware M0/M1.** Fetched `GcodeDispatch.cpp` has no `M0`/`M1` case, and `Player.cpp`
  implements `M600` suspend. Other modules were not searched. ADR-630 Amd 7 keeps the hold text
  for Smoothieware without a source, so the E4-P2-3 class may still apply there.
- **Ctrl+O** (file-menu open) during a held job. Drag-and-drop opening and snapshot restore check
  `isActiveJob`; the menu path was not traced.
- **Reach of M4-P1-2.** Whether common grblHAL posts emit `G43 H` with no `T` word anywhere in the
  file. Fusion, Vectric and Carbide posts were not fetched.
- **Tests not reverted.** E3-P2-1's per-bit file tests and E5-P2-4's note test were read, not
  run against pre-fix code.
- **E4-P2-4 data-loss clause.** Whether METHOD §3's P1 "loses or corrupts user data" overrides the
  P2 "security weakness … unusual conditions" clause is left to the coordinator.
- No hardware was run.

```json
[
  {"id":"M4-P1-1","severity":"P1","area":"meta-controller-v4","file":"src/ui/state/store-actions.ts","line":149,"anchor":"Contract: ADR-416 decision 1 and Amendment 1 (held CNC job keeps its mode); Twin: MachineModeToggle lock and use-machine-setup-save guard vs undo/redo","evidence":"REPRO","verdict":"CONFIRMED","known":false,"corrects":"E2-P2-2 (#1399)","kind":"Fix ineffective","summary":"Undo during a CNC job held at a tool change restores a Laser project; Jog to point then sends only $J=G91 G21 X50 Y50 with no safe-Z lift and no Work-Z check (CNC mode refuses the same move)"},
  {"id":"M4-P1-2","severity":"P1","area":"meta-controller-v4","file":"src/core/controllers/console-state-effect.ts","line":24,"anchor":"Ground truth: grblHAL gcode.c @4ec1ae44 L1670-1683, L2944-2967 (G43/G43.2 H apply tool table offsets), L5023-5026 (G8 group not reset at program end); Twin: G43.1 voids Work Z, G43/G43.2 do not","evidence":"REPRO","verdict":"CONFIRMED","known":false,"corrects":"E4-P2-1 (#1413)","kind":"Fix ineffective","summary":"An opened grblHAL program with G43 H<n> or G43.2 H<n> and no T/M6/G43.1/G92 Z word leaves the TLO applied and Work Z current; next CNC Start skips Zero Z and cuts at the offset depth; Console shares the rule"},
  {"id":"M4-P3-1","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":20,"anchor":"Record vs GitHub (gh pr view 1411/1412/1413)","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"controller-v4 LEDGER","kind":"Stale record","summary":"Seven status cells lack 'merged'; header/totals and E4-P1-1 row text contradict the (P1) corrections; E5-P2-4's #1411 mitigation unrecorded; E1-P2-1 P1 note cites the dark case"},
  {"id":"M4-P3-1.01","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":25,"anchor":"gh pr view 1413","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E4-P1-1","kind":"Stale record","summary":"#1413 -> merged 17f4d6b68 (2026-10-23 01:16Z)"},
  {"id":"M4-P3-1.02","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":26,"anchor":"gh pr view 1413","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E4-P2-1","kind":"Stale record","summary":"#1413 -> merged 17f4d6b68"},
  {"id":"M4-P3-1.03","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":27,"anchor":"gh pr view 1412","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E4-P2-2","kind":"Stale record","summary":"#1412 -> merged 117e8524f (00:45Z)"},
  {"id":"M4-P3-1.04","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":28,"anchor":"gh pr view 1412","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E4-P2-3","kind":"Stale record","summary":"#1412 -> merged 117e8524f"},
  {"id":"M4-P3-1.05","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":30,"anchor":"gh pr view 1411","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E5-P2-1","kind":"Stale record","summary":"#1411 -> merged 48f3d8b5a (00:59Z)"},
  {"id":"M4-P3-1.06","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":31,"anchor":"gh pr view 1411","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E5-P2-2","kind":"Stale record","summary":"#1411 -> merged 48f3d8b5a"},
  {"id":"M4-P3-1.07","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":32,"anchor":"gh pr view 1411","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E5-P2-3","kind":"Stale record","summary":"#1411 -> merged 48f3d8b5a"},
  {"id":"M4-P3-1.08","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":14,"anchor":"Ledger internal consistency; METHOD §3 / M3 C6-P2-1 dark-failure reasoning","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"E1-P2-1, E4-P1-1 header/totals/row text","kind":"Contradiction","summary":"Header (E1 P1 0, E4 P1 0 'lowered') and totals 'P1 0, P2 13 ... lowered to P2 (reach)' and E4-P1-1 text 'Lowered from P1 for reach' contradict the (P1) rows; E1-P2-1's P1 basis is the silent under-burn at tops 20-99, not the dark $30=1 case"},
  {"id":"M4-P3-1.09","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/LEDGER.md","line":14,"anchor":"ADR-497 Amendment 1 decision 4 (#1411)","evidence":"SOURCE","verdict":"CONFIRMED","known":null,"corrects":"E5-P2-4","kind":"Stale record","summary":"#1411 took E5-P2-4 (capped-runway note); ledger does not record it"},
  {"id":"M4-P3-2","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E2-ctl-machine-setup-flow.md","line":219,"anchor":"METHOD §3 P1 'move the machine unexpectedly'; clarification: no reach clause","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"E2-P2-2","kind":"Wrong severity","summary":"Kept P2 only because the sequence is 'deliberate, unusual'; bit dragged at depth with no lift and no warning is P1 by effect (fixed by #1399 for Save)"},
  {"id":"M4-P3-3","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E3-ctl-cnc-routines.md","line":279,"anchor":"METHOD §3 P1 'move the machine unexpectedly' / silent wrong position","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"E3-P2-2","kind":"Wrong severity","summary":"On stock GRBL defaults the tile Frame itself drives 80 mm past the bed and loses steps, GRBL reports Frame complete; reasons were reach and a visibility that is the harm itself; P1 by effect (fixed by #1403)"},
  {"id":"M4-P3-4","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E4-ctl-external-normalize.md","line":262,"anchor":"METHOD §3 P1 silent wrong depth","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"E4-P2-1","kind":"Wrong severity","summary":"Silent wrong depth from G43.1/G10 L20 Z/M6 T kept P2 for rare idioms and an after-the-fact 'visibly airborne'; P1 by effect, as E4-P1-1 (fixed by #1413, gap M4-P1-2)"},
  {"id":"M4-P3-5","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E4-ctl-external-normalize.md","line":324,"anchor":"METHOD §3 P1 silent wrong position; NN21/ADR-565 Frame is spatial truth","evidence":"READ","verdict":"CONFIRMED","known":null,"corrects":"E4-P2-2","kind":"Wrong severity","summary":"Run reaches X120 while the Frame traced X0-10 and the review said the lines were 'skipped'; kept P2 for reach; P1 by effect like E4-P1-1 (fixed by #1412)"},
  {"id":"M4-P3-6","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E4-ctl-external-normalize.md","line":365,"anchor":"METHOD §3 P1 'move the machine unexpectedly'; gnea/grbl gcode.c L251; FluidNC v4.0.3 GCode.cpp L633-635","evidence":"SOURCE","verdict":"REFUTED","known":null,"corrects":"E4-P2-3","kind":"Wrong severity","summary":"Review promised an M1 hold that GRBL/FluidNC ignore; kept P2 for reach only; P1 by effect (fixed by #1412)"},
  {"id":"M4-P3-7","severity":"P3","area":"meta-controller-v4","file":"docs/audits/2026-10-22-controller-v4/E5-ctl-material-tests.md","line":309,"anchor":"METHOD §3 clarification (reach lowers to P3 only when unreachable); ADR-497 D6 'whole run-up ... Shorter is never used'","evidence":"READ","verdict":"PLAUSIBLE","known":null,"corrects":"E5-P2-4","kind":"Wrong severity","summary":"Lowered to P3 for reach and ADR acceptance of the cap, but the catalogue Falcon A1 Pro reaches it and no ADR accepts the false 'reaches 20,000' note; P2 at least (P1 argument on constant power); mitigated by #1411 decision 4"},
  {"id":"M4-P3-8","severity":"P3","area":"meta-controller-v4","file":"src/ui/gcode-inspector/use-external-program.ts","line":46,"anchor":"ADR-630 Amd 7 claim vs controller-identity-warnings.ts consumers (Job Review only)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"corrects":"E4-P2-2, E4-P2-4 (#1412, #1410)","kind":"Bad citation","summary":"Under a GRBL profile a FluidNC/grblHAL board's #/[expr]/G65/M98 lines are sent and reviewed as stock-GRBL errors; the identity warning ADR-630 Amd 7 relies on is not in the Run review"},
  {"id":"M4-P3-9","severity":"P3","area":"meta-controller-v4","file":"src/core/external-program/storage-command-check.ts","line":43,"anchor":"Smoothieware CartGridStrategy.cpp @91fe4286 L77, L454-464","evidence":"REPRO","verdict":"CONFIRMED","known":false,"corrects":"E4-P2-4 (#1410)","kind":"Fix ineffective","summary":"Smoothieware M375 (load stored grid, enable Z compensation) is not refused, while M374 and M501 are"},
  {"id":"M4-P3-10","severity":"P3","area":"meta-controller-v4","file":"src/core/external-program/external-program-review.ts","line":93,"anchor":"ADR-630 Amd 6 'Not in this decision' vs review text :93 and :290","evidence":"READ","verdict":"CONFIRMED","known":false,"corrects":"E4-P2-1 (ADR-630 Amd 6)","kind":"Bad citation","summary":"ADR says the Run review warns that later jobs start from a changed origin after G92 X Y; only the G10 L warning says so; Marlin host-recorded shift unaddressed"}
]
```
