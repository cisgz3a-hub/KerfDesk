# Controller audit v2 — C3 Homing, envelope and jog (`ctl-homing-envelope-jog`)

- **When:** 2026-10-22 09:15   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `d4a4ffda0`;
  only audit docs differ from `99a2e64b7`; `git fetch` at 09:05 showed origin/main unchanged)
- **Scope:**
  - Core: `src/core/controllers/grbl/grbl-homing-duration.ts`, `machine-envelope.ts`,
    `jog-travel-limits.ts`, `frame-lines.ts`; `src/core/devices/native-bed-frame.ts`,
    `jog-direction.ts`, `origin-transform.ts` (as consumed here).
  - Store: `src/ui/state/manual-motion-limits.ts`, `native-bed-frame.ts`, `laser-jog-actions.ts`,
    `laser-home-action.ts`, `laser-frame-motion-plan.ts`, `laser-jog-warnings.ts`,
    `laser-motion-cancel.ts` (release path only), `grbl-settings-evidence.ts` (envelope refresh).
  - UI: `src/ui/laser/JogPad.tsx`, `JogArrowGrid.tsx`, `use-hold-jog.ts`, `jog-control-policy.ts`,
    `use-jog-shortcuts.ts`, `src/ui/workspace/position-laser-click.ts` (Move laser here),
    `head-move-dispatch.ts` and `OriginRow.tsx` Go to work zero (as further jog sources).
  - Governing: ADR-375 decision 3 (manual motion inside the firmware's limits, pull-off), ADR-375
    Amendment 1, ADR-232 (bounds warn, controller decides), ADR-373 (residual jog risk), ADR-565
    and PROJECT.md non-negotiable 21 (Frame), ADR-640 (jog cancel), ADR-400 (ST-4 homing wait).
- **Lenses run:** L2, L4, L3, L1, L7 as separate passes, in that order of weight. L6 was folded in
  (what the operator sees on error:15, a homing alarm, a lost release). L5 skipped: the only input
  is the controller's own `$$`/`$I`/status, already treated as trusted controller evidence.
- **Primary sources fetched this session:**
  - GRBL v1.1 configuration wiki (`$13`, `$20`–`$27`, `$130`–`$132`).
  - gnea/grbl `bfb67f0c`: `limits.c` (`limits_go_home`, hard-limit ISR), `system.c`
    (`system_check_travel_limits`), `jog.c`, `gcode.c` (jog block), `stepper.c` (laser PWM),
    `report.c` (`[OPT:]` Z), `config.h`.
  - grblHAL core `d7aaee3d`: `machine_limits.c` (`limits_set_work_envelope`,
    `limits_set_machine_positions`, homing loop), `motion_control.c` (`mc_jog_execute`),
    `settings.c`/`settings.h` (`$22` bitfield, `$24`/`$25`, per-axis homing rates, `$40`),
    `report.c` (`[OPT:]`), `config.h` (scalars, defaults).
  - FluidNC `fdc17a2c` `Jog.cpp`.
  - Chromium CL 2716063002 (pointer events reach disabled form controls).
- **Counts:** 5 raised → 0 refuted (refuter: 5 CONFIRMED, no severity changes) → P1 0 / P2 2 /
  P3 3 (+ 4 KNOWN re-observed).

## Headline

Stock GRBL is modelled correctly. Its `$23` / force-origin envelope, the native-bed corner for
every origin, the pull-off inset, the rounding margin, inch reports and the homing-time bound all
match gnea/grbl line for line, and the hold-to-jog release path holds up.

grblHAL is where the envelope breaks down. KerfDesk takes "force set origin" only from stock GRBL's
`$I` `[OPT:]` Z and never sends `$I` to grblHAL. It also ignores grblHAL's own `$22` bit 3, which
the `$$` dump it already reads carries. So on any grblHAL machine whose homing direction mask
(`$23`) has an X or Y bit set, press-and-hold jog gets no envelope:

- With soft limits on, it asks for a whole bed width, and grblHAL refuses every hold with
  error:15 ("Jog target exceeds travel. Reduce the jog distance.").
- Separately, with soft limits off but hard limits on, the grblHAL hold gets no pull-off inset
  for any mask. Holding toward the homing corner runs onto the switch and trips ALARM:1, where
  stock GRBL stops `$27` short.

## Flow map

| Source | Entry | Wire | Clamp | Beam |
|---|---|---|---|---|
| Arrow click / keyboard XY key (ADR-493) | `JogArrowGrid` → `jog()` | `$J=G91 G21 X±step F` | none (ADR-375: step jogs unchanged, ADR-232 warns) | modal state (ADR-373) |
| Arrow hold (250 ms) | `useHoldJog.onHold` → `continuousJogVector` → `jog()`; release/blur/unmount → `cancelJog()` → `0x85` | `$J=G91 G21 X±d F` | `resolveManualMotionLimits(frame, evidence)`; none → full bed width | modal state (ADR-373) |
| PageUp/PageDown | `jog({dz})` | `$J=G91 G21 Z±step F600` | none | modal state |
| Move laser here | `dispatchPositionLaser` → `jogToMachinePosition` | CNC safe-Z retract, then `$J=G91` delta from reported MPos | needs a verified frame; clamped to frame ∩ firmware limits | modal state |
| Typed/saved/selection head move, Go to work zero, recovery move | `dispatchHeadMove` / `GoToWorkZeroButton` / `moveHeadToWorkPoint` → `jogToMachinePosition` | as above | none (ADR-375 "typed head moves unchanged") | modal state |
| Head-camera capture | `head-capture-store.ts:jogHeadTo` | as above | none (**KNOWN 12-P2-3**) | modal state |
| Frame | `runFrame` → `buildFrameDispatchPlan` | `M5`, `M9`, then `$J=G90 G21 X Y F` per corner (+ CNC safe Z), settle `G4 P0.01` | none (ADR-375: Frame corners unchanged) | **off** (driver tool-off lines first) |
| Home | `runHomeAction` | `$H` (or vendor lines), settle marker, verify, fresh Idle | — | n/a |

Envelope inputs: `$130`/`$131` (`bedWidth`/`bedHeight` in the snapshot), `$23`, `$20`, `$21`
(bit 0), `$27`, `$100`/`$101`, this session's `$I` `[OPT:]` Z on stock GRBL only, and the session
stamps. A settings write clears the observation before dispatch, and `$20/$22/$23/$130–$132`
also void homing (`grbl-settings-evidence.ts:36-50`), so the envelope and the bed frame are
recomputed only from a fresh `$$` and a fresh Home.

## Findings

### P2-1 — grblHAL with an X or Y homing-direction bit gets no jog envelope; every press-and-hold is refused with error:15 when soft limits are on

- **Where:**
  - `src/ui/state/manual-motion-limits.ts:83`. `forceOrigin` is taken only from the stock-GRBL
    `$I`, and is `null` for grblHAL.
  - `src/core/controllers/grbl/jog-travel-limits.ts:74`. `forceOrigin === null && xyMask !== 0`
    returns null.
  - `src/core/controllers/grbl/parse-settings.ts:180`. `$22` is reduced to bit 0, so bit 3 is
    dropped.
  - `src/core/controllers/grblhal/driver.ts:84`. `buildInfoQuery: null`, so grblHAL is never asked
    `$I`.
  - `src/ui/laser/JogPad.tsx:203-211`. With `limits === null`, the hold has no position and spans
    the profile bed width.
- **Anchor:**
  - Ground truth, grblHAL `d7aaee3d`:
    - `machine_limits.c:116-140` (`limits_set_work_envelope`): without force origin the
      envelope is `[max_travel + pulloff, -pulloff]` for every `$23`.
    - `settings.h:714-718`: `$22` bit 3 is `force_set_origin`.
    - `settings.c:1775-1779`: at COMPATIBILITY_LEVEL ≤ 1 (default 0), `$22` prints the whole
      bitfield.
    - `report.c:944-945`: `[OPT:]` prints Z for it.
    - `motion_control.c:832-835`: with `$40=0` (default Off, `config.h:1945-1946`) a jog target
      outside the envelope returns `Status_TravelExceeded`.
  - Contract: ADR-375 decision 3, "grblHAL … its clamp applies after this session's Home, from
    grblHAL's own envelope". No `$23` exception is stated.
  - Twin: stock GRBL with the same `$$` gets a clamp (`manual-motion-limits.test.ts`, "needs $I
    force-origin evidence for a negative-homing axis").
- **Scenario:**
  - Setup: a grblHAL laser homing toward −X (left-side switches: `$23=1` or `3`), with `$20=1`,
    `$21=1`, `$27=2`, `$130=400`, `$131=300`, and a profile bed of 400 × 300 (KerfDesk's own "Use
    detected" sets the bed from `$130/$131`).
  - Home succeeds. After homing the head rests at MPos X −398 (`machine_limits.c:156-159`).
  - The operator holds the → arrow. KerfDesk sends `$J=G91 G21 X400.000 F3000`.
  - The target X 2 lies outside grblHAL's [−398, −2], so grblHAL answers error:15. KerfDesk shows
    "Jog target exceeds travel. Reduce the jog distance.", which the operator cannot act on.
  - The ← arrow (target −798) and every diagonal fail the same way, from anywhere on the bed.
  - The hold works only if the profile bed is smaller than travel − 2 × pull-off, or `$40=1`.
- **Evidence:**
  - REPRO, a temporary Vitest (`src/ui/state/zz-c3-grblhal-hold.test.ts`, deleted).
    - Input: a real `$$` map put through `settingsMapToControllerSettings` → grblHAL evidence,
      homed this session.
    - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-c3-grblhal-hold.test.ts --silent=false`.
    - Output: `grblHAL $23=3 frame null limits null`; `hold +X vector { dx: 400, feed: 3000 }`;
      `grblHAL envelope X { min: -398, max: -2 } start -398 target 2 refused (error:15)? true`.
    - Control: the same dump with `$23=0` gives
      `{ minX: -397.99, maxX: -2.01, minY: -297.99, maxY: -2.01 }`.
  - SOURCE grblHAL `machine_limits.c` L134-135: "min … = settings.axis[idx].max_travel + pulloff".
  - L7: `jog-travel-limits.test.ts:117` pins `GRBLHAL` with mask 3 → `null` as intended behaviour.
- **Refuter:** CONFIRMED (REPRO + SOURCE). P2 kept.
  - Source, re-fetched at grblHAL `d7aaee3d`:
    - `$22` bit 3 is `force_set_origin` (`settings.h:714-725`), named "Set machine origin to 0" in
      `homing_options` (`settings.c:473`).
    - `$$` prints the whole `$22` bitfield at COMPATIBILITY_LEVEL ≤ 1 (`settings.c:1775-1782`).
      The default level is 0 (`config.h:96-97`).
    - So force origin is in the `$$` dump, not only in `$I` `[OPT:]` Z (`report.c:944-945`).
  - The envelope does not depend on `$23`. `limits_set_work_envelope` (`machine_limits.c:116-140`)
    gives [−398, −2] for every `$23` when force origin is off.
  - The refusal is error:15. With `$40` off (`DEFAULT_JOG_LIMIT_ENABLE Off`, `config.h:1944-1946`),
    `mc_jog_execute` returns `Status_TravelExceeded` (`motion_control.c:832-835`), which is 15
    (`errors.h:47`).
  - Repro through the real code (temporary Vitest, deleted).
    - Input: `settingsMapToControllerSettings` on a grblHAL `$$` (`$20=1 $21=1 $22=1 $23=3 $27=2
      $130=400 $131=300`), homed this session.
    - Result: frame `null`, limits `null`. The → hold gives `{dx:400}` →
      `$J=G91 G21 X400.000 F3000`, and the ← hold gives `{dx:-400}`.
    - Scanning grblHAL's whole X envelope in 0.5 mm steps, 0 holds land inside it.
    - `$22=1` and `$22=9` give identical snapshots, so bit 3 is dropped.
    - `$23=1` alone also gives `null`. The `$23=0` control gives the clamp.
  - This is not an accepted decision.
    - The pinned test calls the case "force origin not known".
    - ADR-375 decision 3 gives grblHAL its clamp "from grblHAL's own envelope" with no `$23`
      exception. Decision 8 reads `$22` by bit 0 and never weighs bit 3.
    - The module header says the clamp exists to avoid error:15.
  - Severity:
    - The effect is only a refused jog: no motion, no alarm, and the position is kept.
      `laser-parser-rearm.ts` clears grblHAL's latched error.
    - It stays P2, not P3, because it is reachable today on a common grblHAL laser setup
      (left-side switches with `$20=1`), and every hold fails.
    - The error message asks the operator to reduce a distance they never chose. That is METHOD §3
      P2: "ordinary user … misleading result".
    - There is no safety impact, so this is low in P2.
  - Novelty: no open PR touches these files. Design audit D-4 covers grblHAL identity only.
- **Fix direction:**
  - Read grblHAL's force-origin flag from `$22` bit 3, which is already in the dump, and keep the
    raw value in the snapshot. Also use `[OPT:]` Z where `$I` is read (controller design audit
    D-4).
  - Treat grblHAL's envelope as known for every `$23`, as `limits_set_work_envelope` does.
  - Adjust the pinned test.

### P2-2 — grblHAL with soft limits off gets no pull-off inset; a held arrow toward the homing corner runs onto the switch (ALARM:1), where stock GRBL stops `$27` short

- **Where:**
  - `src/ui/state/manual-motion-limits.ts:43`. Without a verified frame, firmware limits are used
    only when `softLimitsEnforced`.
  - `src/ui/state/native-bed-frame.ts:90-95`. A frame needs stock-GRBL identity and a stock `$I`,
    so grblHAL never has one.
  - Together, a homed grblHAL with `$20=0` returns null.
- **Anchor:**
  - Contract, ADR-375 decision 3, fourth bullet: "With hard limits on (or `$21` unread),
    hold-to-jog and Move laser here stop `$27` short of the homing switch on each axis's homing
    side … a hard limit resets the controller into `ALARM:1` with the position lost."
  - Twin: stock GRBL with identical `$$` and a verified frame clamps to max −2 (repro below).
  - Ground truth: grblHAL's position after Home is meaningful whether or not soft limits are on
    (`machine_limits.c:144-160` sets `home_position` from `$130` and `$27`).
- **Scenario:**
  - Setup: a grblHAL laser homing +X/+Y (`$23=0`) with `$20=0`, `$21=1` and `$27=2`. Soft limits
    are off by default and hard limits are commonly enabled once switches are fitted.
  - After Home the head rests at X −2, and the switch trips at X 0.
  - The operator holds → to bring the head to the right edge. KerfDesk sends
    `$J=G91 G21 X400.000 F3000`.
  - The head reaches the switch. grblHAL raises ALARM:1 and the position is lost, so a reset and
    a re-home follow.
  - The same hold on stock GRBL stops at X −2.
  - With `$23≠0` the same happens through P2-1's null.
- **Evidence:**
  - REPRO, same temporary test.
    - Output:
      `grblHAL soft-off limits null hold +X from -2 asks dx 400 -> target 398 (switch at 0)`.
    - Control (stock GRBL, same dump): `frame { minX: -400, maxX: 0, … } limits { minX: -400,
      maxX: -2, minY: -300, maxY: -2 }`.
  - L7: `manual-motion-limits.test.ts` covers grblHAL only with soft limits on and `$23=0`.
- **Refuter:** CONFIRMED (REPRO). P2 kept.
  - Repro (same temporary Vitest), with `$20=0 $21=1 $23=0` on grblHAL, homed:
    - Limits are `null`, and the → hold gives `{dx:400}`.
    - grblHAL's home is −2 (`limits_set_machine_positions`, `machine_limits.c:144-160`), so the
      target is 398 and the switch is at 0.
    - Stock GRBL, same dump with `$I`: frame [−400, 0], limits maxX −2.
    - grblHAL with `$20=0` and `$23=3` also gives `null`.
  - The header comment is not a documented acceptance of this case.
    - `manual-motion-limits.ts:22-27` describes the behaviour. So does `JogPad.tsx:186-189`: "With
      neither a frame nor soft limits, the hold asks for full travel".
    - Their reason is an unanchored position: stock GRBL without a frame, whose MPos has no known
      relation to the switch.
    - A grblHAL that KerfDesk saw home this session is anchored. `jogTravelSettings` already
      relies on that anchor for `$20=1`.
    - ADR-375's hard-limit bullet is not conditioned on soft limits.
    - Its "unchanged" list is no `$$`, FluidNC, Marlin, Smoothieware, Ruida and WPos-only. It
      does not name grblHAL.
    - On stock GRBL, `manual-motion-limits.test.ts` "insets the switch edge even with soft limits
      off" pins the opposite intent.
  - Severity:
    - The switch is `$27` beyond the rest point (1 mm by default, `config.h:1667`). At 3000 mm/min
      the operator has about 20–40 ms to let go.
    - The result is ALARM:1, a reset, and position lost until a re-home.
    - It is not P1. The motion is held by the operator, it stops at the switch, and no beam is
      added.
    - It is P2: `$20=0` is grblHAL's default (`config.h:1048`), there is a clear failure
      scenario, and the twin disagrees.
- **Fix direction:** On grblHAL homed this session, apply the pull-off inset from the known
  envelope even when `$20=0`, as stock GRBL already does through its frame.

### P3-1 — The grblHAL Home wait ignores per-axis homing rates (`$22` bit 9) and axes past Z, so a valid Home can be reported unfinished

- **Where:** `src/core/controllers/grbl/grbl-homing-duration.ts:42-44` uses `$24`/`$25` for every
  axis and only `$130`–`$132`. `src/ui/state/laser-home-action.ts:82` applies it.
- **Anchor:** Ground truth, grblHAL `d7aaee3d`:
  - With per-axis feed rates, each axis homes at its own rate (`machine_limits.c:683`;
    `settings.c:1575-1585`, `$180+`/`$190+`).
  - `$24`/`$25` then print axis 0's rates only (`settings.c:1656-1662`).
  - A 4th homed axis searches `1.5 × $133` (`machine_limits.c:306-309`).
- **Scenario:**
  - Dump: `$22=513` (homing + per-axis rates), `$25=3000`, `$24=300`, `$191=300` (Y seek),
    `$181=100`, `$131=1000`.
  - The bound is 51.5 s, so the Home line waits max(120 s, 107 s) = 120 s.
  - Y alone can need 312.8 s (a full search from the far end).
  - At 120 s KerfDesk says "Home did not finish", sets homing unknown and releases the controls
    while the machine is still homing. This is the ST-4 failure mode, on a non-default
    configuration.
- **Evidence:**
  - REPRO, same temporary test: `bound ms 51540 home line timeout ms 120000 Y axis alone needs ms
    312800`.
  - SOURCE: grblHAL `settings.c` L1657, "value = settings.axis[0].homing_feed_rate".
- **Refuter:** CONFIRMED (REPRO + SOURCE). P3 kept.
  - Source:
    - `$18x`/`$19x` are `Setting_AxisHomingFeedRate`/`SeekRate` (`settings.h:561-562`), and they
      apply only with bit 9 set (`settings.c:1575-1585`).
    - `$24`/`$25` print axis 0 (`settings.c:1656-1662`).
    - The homing loop takes each axis's own rate (`machine_limits.c:683`).
  - Repro through the real `homeLineTimeoutMs` and `grblHalDriver`:
    - Input: `$22=513 $24=300 $25=3000 $26=250 $27=2 $131=1000 $181=100 $191=300`.
    - Result: a bound of 58.7 s and a wait of 120 s, while Y alone needs 313.8 s.
  - It stays P3: per-axis rates are not the default.
- **Fix direction:**
  - On grblHAL with `$22` bit 9, take each axis's own `$18x`/`$19x`.
  - Include `$133+` for homed extra axes.
  - Or fall back to the 30-minute backstop when per-axis rates are on.

### P3-2 — `validateEnvelopeSettings` and `EnvelopeSettings` are dead code whose rules contradict the live envelope path, and only their own test calls them

- **Where:** `src/core/controllers/grbl/machine-envelope.ts:8-16, 54-80`. A repo-wide grep finds no
  caller outside `machine-envelope.test.ts`.
- **Anchor:**
  - Twin, against `jog-travel-limits.ts` and `native-bed-frame.ts`. The live path:
    - accepts `$21=0`, `$20=0` and an unread or zero `$27`;
    - uses no `$10` rule.
  - The dead validator does the opposite on each point:
    - requires soft limits, homing and a positive pull-off;
    - rejects any `$10` other than 1 or 3.
  - L7: tests assert behaviour no product path has.
- **Scenario:** A maintainer reading `machine-envelope.ts` takes these as KerfDesk's envelope
  preconditions, and wires them into a new consumer. That consumer would then refuse a `$27=0` or
  `$20=0` machine that the jog clamp handles correctly.
- **Evidence:** READ, by grep.
- **Refuter:** CONFIRMED.
  - A whole-worktree grep (excluding `node_modules`) finds `validateEnvelopeSettings` and
    `EnvelopeSettings` only in `machine-envelope.ts`, `machine-envelope.test.ts` and this report.
    No barrel re-exports them.
  - The validator requires `$10` ∈ {1, 3}, soft limits, homing, a mask of 0–7 and a pull-off
    above 0. The live path requires none of these.
- **Fix direction:** Delete the validator and its type, or move the live preconditions into it and
  call it from `jogTravelSettings`/`stockNativeBounds`.

### P3-3 — The `$21` comment in `JogTravelSettings` says a grblHAL bitfield reads as undefined; the parser reads it as true

- **Where:** `src/core/controllers/grbl/jog-travel-limits.ts:31` ("undefined when not read as 0/1
  (a grblHAL bitfield such as 3)"). `parse-settings.ts:179` uses `grblEnableBit`, so 3 → `true`.
- **Anchor:** Twin, comment against code. ADR-375 says "(or `$21` unread)", not "or a bitfield".
- **Scenario:** No wrong motion. A grblHAL `$21=3` (hard + strict) is read as hard limits on,
  which is right. The comment would lead a reader to expect the 1 mm unknown-pull-off path.
- **Evidence:** READ.
- **Refuter:** CONFIRMED.
  - `grblEnableBit` (`parse-settings.ts:285-288`) returns `value % 2 === 1` for any non-negative
    integer, so `$21=3` → `true`. Only non-integers and negative values give `undefined`.
  - The comment at `jog-travel-limits.ts:31` is wrong. No motion changes.
- **Fix direction:** Reword the comment to "`$21` bit 0".

## KNOWN (re-observed, not re-raised)

- **Rolling-v2 12-P2-3.** Head-camera capture jogs skip the pull-off clamp.
  `head-capture-store.ts:182-189` is unchanged on `99a2e64b7`.
- **ADR-373 residual risk.** A `$J=` jog keeps the controller's modal M3/M4 and S.
  - Re-checked against gnea/grbl `gcode.c:859-865`. Jog takes `gc_state.spindle_speed` and the
    modal spindle, and returns before the laser-mode disable at `:869`. In laser mode,
    `stepper.c:958-963` drives that S during the jog.
  - No KerfDesk jog source sends M5 first. Frame does (`frameToolOffLines`).
  - ADR-373 accepts this for "a laser left on by a hand-typed console command". Since ADR-630,
    there is a second way to leave M3/M4 modal: an opened program that ends lit. Its review only
    warns (`external-program-review.ts:309-320`).
  - The maintainer may want to revisit whether jogs should send the driver's tool-off lines as
    Frame does.
- **Controller design audit 2026-10-20 D-4.** grblHAL is never asked `$I`. P2-1's `[OPT:]` route
  depends on it, but its `$22` route does not.
- **Controller protocol audit 2026-10-20 P-3.** Step jogs cannot be queued while a jog runs
  (`isJogPadDisabled`).

## Refuted

The refuter refuted none of the five findings.

Candidates this audit raised and dropped itself:

- **Step jogs, keyboard jogs, typed head moves and Frame corners are not clamped to the
  envelope.** Dropped as by design. ADR-375 decision 3: "Step jogs, typed head moves and Frame
  corners are unchanged (ADR-232 leaves those limits to the controller)."
- **A Frame or job corner on the homing-side bed edge lands on the switch.** Dropped for the same
  reason. Bed 0 equals the switch point on stock GRBL without force origin, but GRBL's own soft
  limits allow it too, and ADR-375 leaves Frame to the controller.
- **The hold's release is lost when the pad turns disabled mid-hold.** Dropped.
  - `isJogPadDisabled` disables the button as soon as `motionOperation` is set.
  - React does not filter pointer events on disabled elements (`react-dom` `shouldPreventMouseEvent`
    lists only click and mouse events).
  - Chromium dispatches pointer events to disabled form controls (CL 2716063002).
  - Pointer capture, `pointercancel`, window `blur` and unmount also route to `cancelJog`.
- **Settings changes leave a stale envelope.** Dropped.
  - Every `$N=` write clears the observation before dispatch (`grbl-settings-evidence.ts:24`).
  - Position-affecting ids void homing (`console-command.ts:66-68`, `grbl-settings-evidence.ts:36-50`).
  - A fresh `$$` is required before limits or a frame return.
- **FluidNC's full-travel hold is refused or unsafe with soft limits.** Dropped. FluidNC
  `Jog.cpp:15` constrains the jog target (`constrain_jog`) before planning.

## Verified clean

- **`$23` and force origin → envelope → bed corner on stock GRBL.**
  - `deriveMachineEnvelope` matches `system.c:334-352` exactly: [−W, 0] without force origin;
    with it, [0, W] for a set bit and [−W, 0] for a clear one.
  - `[OPT:]` Z is HOMING_FORCE_SET_ORIGIN (`report.c:391-392`).
  - `nativeBedFrame` maps native min to bed min by translation only. Every origin, centre
    included, puts the homed rest at the right physical corner. Checked by hand for all four `$23`
    XY values × force origin × front-left, rear-left, front-right and centre against
    `limits.c:366-384`.
  - `jogAxisSignsForOrigin` agrees with `origin-transform.ts`.
- **Pull-off and margin (stock GRBL).**
  - The homing-edge inset is `$27`, or 0 with force origin or `$21=0`. The far edge is uninset.
  - Margin: max(0.01, ½ step + 0.002). It covers MPos 3-decimal rounding, inch 4-decimal
    rounding (0.00127 mm) and the 3-decimal jog distance.
- **grblHAL with `$23=0` and soft limits on:** the clamp equals `limits_set_work_envelope` plus the
  margin.
- **Inch reports (`$13=1`).**
  - `$130`–`$132` and `$27` are always mm (wiki: inches apply to reporting).
  - MPos, WCO and the hidden MPos are converted once.
  - Jogs carry G21.
- **Homing wait on stock GRBL and on default grblHAL.**
  - The 4-move cycle (1.5 × travel search at `$25`, pull-offs at `$25`, locate 5× (GRBL) or
    10× (grblHAL) `$27` at `$24`, `$26` per move, `$43` locate cycles) matches `limits.c:171-364`
    and grblHAL `machine_limits.c:272, 480-530`.
  - The per-axis sum bounds every cycle grouping, because GRBL's search is the cycle's maximum.
  - Example: a 1300 × 900 mm bed at `$25=1000` gives a bound of 224 s and a 366 s wait, against
    about 130 s worst case.
- **A homing alarm mid-cycle (ALARM:8/9)** rejects the owned Home through the alarm line, keeps
  positions suppressed and logs it. The stale pre-`$H` Alarm reply is tolerated once
  (`laser-home-alarm-reply.ts`). Covered by `laser-home-action.test.ts`.
- **Frame motion is beam-off.** `M5` and `M9` precede the `$J=` perimeter in the same owned
  operation. There is no low-power Frame option. Feeds are capped by `$110`/`$111`/`$112`. The
  canvas preview and the wire use the same `buildFramePerimeter`.
- **Move laser here.**
  - It needs a verified frame.
  - The click is clamped to the bed, then to frame ∩ firmware limits.
  - The relative delta is taken from a fresh-Idle MPos.
  - CNC retracts Z first.
- **Release mid-dispatch.** A release during the fresh-Idle proof poisons the pending hold
  (`cancelPendingManualMotions`, covered by `JogPad.pending-release.test.tsx`).
- **Twin: canvas, clamp and bounds.** The canvas bed, the preflight bed and the clamp's frame
  are one rectangle whenever a frame exists. That is required, because `nativeBedFrame` refuses a
  bed ≠ `$130/$131`. The head marker, the camera head position and the jog warnings all map
  through the same `resolveNativeBedFrame`.

## Not verified

- No hardware run, so these were not checked on a machine:
  - a real switch trip at the pull-off edge;
  - real homing durations;
  - grblHAL `$22` printing at COMPATIBILITY_LEVEL 1 versus 2. Source shows the bitfield at ≤ 1
    and 0/1 above, so at level 2 only `[OPT:]` Z would carry force origin.
- **grblHAL in compatibility mode behind a stock-GRBL profile** ("Grbl 1.1f" banner, stock-format
  `$I`) is modelled as stock GRBL. It gets a far-edge inset of 0 where grblHAL pulls both edges in
  with hard limits, so a hold to the far edge could be refused with error:15. Real `$I` output
  from such a board was not available.
- **Store-level P2-1 with the grblHAL simulator** (error:15 surfaced through the real JogPad) was
  not run, because of the PC's memory pressure. The repro stops at the computed `$J=` line and
  grblHAL's source check.
- **The phone remote's jog limits** (rolling-v2 01) and ADR-640's cancel timing (area 17) were not
  re-audited.

```json
[
  {"id":"C3-P2-1","severity":"P2","area":"ctl-homing-envelope-jog","file":"src/ui/state/manual-motion-limits.ts","line":83,"anchor":"Ground truth: grblHAL d7aaee3d machine_limits.c:116-140 (envelope known for every $23), settings.h:714-718 + settings.c:1775-1779 ($22 bit 3 force_set_origin printed in $$), motion_control.c:832-835 (error:15 with $40=0); Contract: ADR-375 decision 3 grblHAL clamp after Home","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"grblHAL with an X/Y $23 bit gets no jog envelope (force origin read only from stock $I [OPT:Z], never from $22 bit 3), so every press-and-hold asks for a full bed width and grblHAL refuses it with error:15 when $20=1"},
  {"id":"C3-P2-2","severity":"P2","area":"ctl-homing-envelope-jog","file":"src/ui/state/manual-motion-limits.ts","line":43,"anchor":"Contract: ADR-375 decision 3 (hold stops $27 short of the homing switch with hard limits on); Twin: stock GRBL with frame clamps to -$27","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Homed grblHAL with soft limits off gets no pull-off inset (firmware limits used without a frame only when $20=1, and grblHAL never has a frame), so a held arrow toward the homing corner runs onto the switch and trips ALARM:1"},
  {"id":"C3-P3-1","severity":"P3","area":"ctl-homing-envelope-jog","file":"src/core/controllers/grbl/grbl-homing-duration.ts","line":42,"anchor":"Ground truth: grblHAL machine_limits.c:683 and settings.c:1575-1585,1656-1662 (per-axis homing rates with $22 bit 9; $24/$25 print axis 0 only); machine_limits.c:306-309 (extra axes)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"grblHAL Home wait uses $24/$25 and $130-$132 only; with per-axis homing rates or a homed 4th axis a valid Home can exceed the 120 s wait and be reported unfinished while still homing"},
  {"id":"C3-P3-2","severity":"P3","area":"ctl-homing-envelope-jog","file":"src/core/controllers/grbl/machine-envelope.ts","line":54,"anchor":"Twin: jog-travel-limits.ts / native-bed-frame.ts preconditions; METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"validateEnvelopeSettings/EnvelopeSettings have no production caller and encode preconditions ($20=1, $22=1, $27>0, $10 in {1,3}) the live envelope path does not use"},
  {"id":"C3-P3-3","severity":"P3","area":"ctl-homing-envelope-jog","file":"src/core/controllers/grbl/jog-travel-limits.ts","line":31,"anchor":"Twin: parse-settings.ts:179 grblEnableBit($21) reads a grblHAL bitfield 3 as true","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"JogTravelSettings comment says a grblHAL $21 bitfield such as 3 reads as undefined; the parser reads bit 0 (true)"}
]
```
