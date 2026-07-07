# Full Controller Audit

Date: 2026-07-07
Repo: KerfDesk (LaserForge 2.0), worktree `mystifying-nash-c2d3c1`, branch `claude/mystifying-nash-c2d3c1` @ `efe318b`
Scope: the complete controller stack — `src/core/controllers/**` (seam + GRBL, grblHAL, FluidNC, Marlin, Smoothieware, Ruida drivers), `src/core/grbl-streaming.ts`, `src/core/preflight/controller-readiness.ts`, the store-side consumers that drive the seam (`laser-store`, `laser-line-handler`, `laser-stream-ack`, `laser-safe-write`, `laser-job-actions`, `laser-connection-actions`, `laser-status-line`, `laser-error-line`, `laser-motion-operation`, `laser-controller-*`), the serial transport encoding (`platform/web/web-serial.ts`), and the driver/lifecycle test + simulator coverage.
Method: full read of every non-test file above against GRBL v1.1 wire semantics, ADR-094–097, and CLAUDE.md rules. **Findings only — nothing was changed** (collaboration rule 1).

## Verification honesty

- **No hardware was touched** and no live app was driven. Everything below is code-reading plus the repo's own tests/simulators.
- GRBL error/alarm semantics were checked against the gnea/grbl wiki **from memory**, not re-fetched this session. F5 should be re-confirmed against the wiki CSV before anyone edits the table.
- Smoothieware / FluidNC / Marlin firmware behaviors (status `F:` field shape, `$SLP` support, banner-on-reset) are **not verifiable in this tree** — the in-repo simulators encode the authors' assumptions, not firmware truth. Items resting on those assumptions are marked "verify".
- Gate status at audit time: `pnpm typecheck` clean; `pnpm lint` and `pnpm test` results recorded at the bottom.

## Summary

The driver seam (ADR-094) is in good shape: pure data + pure functions, capability gating used consistently in the store (no `kind ===` checks in guards), transport bytes correct (byte-per-char, M12), the streamer a well-pinned pure state machine with terminal-status absorption (H5), error-as-terminal (P0-1), and oversize refusal (M13). Pause/probe/CNC capability policies encode real cross-firmware hazards and are pinned by tests. Ruida honesty (file-only, EXPERIMENTAL, raster refused) matches ADR-097.

The material findings cluster in one place: the **untracked-ack ledger** — the step-5c arming mechanism — has attribution holes that recreate, in narrow windows, the exact phantom-refill class it exists to prevent. Everything else is copy accuracy, dead config, and per-firmware capability questions.

---

## Findings (ranked)

### F1 — Untracked-ack ledger double-counts one ack when untracked writes coexist with unsettled stream acks — MODERATE-HIGH (accounting integrity; phantom-refill class)

`settleUntrackedAck` ([laser-stream-ack.ts:19](../../src/ui/state/laser-stream-ack.ts)) decrements `pendingUntrackedAcks` for **any** terminal ack whenever the counter is > 0 — even when it then attributes that same ack to the stream (`hasUnsettledStreamAcks` true → returns `'stream'`, and the ok also flows into `advanceStream`). One physical `ok` settles both ledgers.

Trigger that reaches it: the cross-firmware **stop path**. `stopJob` ([laser-job-actions.ts:108](../../src/ui/state/laser-job-actions.ts)) writes `stopLaserLines` (each +1 on the counter) while the cancelled streamer still holds in-flight entries. On **Marlin** (no realtime bytes, stream-side stop) the controller still acks the in-flight job line(s) *and* the M5/M107 lines — and those acks can be **seconds** late (Marlin acks on buffer-accept; a full planner delays serial reads). Receive order is: job-line ok(s) first, then M5, then M107. The first ok correctly goes to the stream but *also* decrements the counter — so the counter reaches 0 while M107's ok is still in flight.

Consequence, stated precisely as a two-stage race: (1) the double-decrement makes the counter under-count by one for the rest of the drain — so the Start arming gate (`pendingUntrackedAcks === 0` + the 25 ms drain poll, [laser-job-actions.ts:54](../../src/ui/state/laser-job-actions.ts)) unblocks on the **second-to-last** owed ack. This stage has a wide window: with stream-side stop, Marlin's planner keeps executing for seconds and the operator plausibly hits Start during the drain. (2) The final owed ok then lands with the counter at 0 and is attributed `'stream'`; if the new job's first chunk is already in flight at that instant, it **phantom-advances the fresh streamer** — frees RX budget the controller has not freed, verbatim the P0 class the mechanism guards against (comment at [laser-store.ts:111](../../src/ui/state/laser-store.ts)). Stage 2 is a tight race (the stale ok must arrive after the new streamer exists — tens of ms), so the catastrophic outcome is unlikely per occurrence — but stage 1's invariant break is unconditional, silent, and exercised on every Marlin/Smoothie stop with lines still in flight. On ping-pong Marlin a phantom ack means the stream runs permanently one-line-ahead; on char-counted firmwares it is an RX over-commit.

The pinned tests ([laser-store-untracked-ack-guard.test.ts](../../src/ui/state/laser-store-untracked-ack-guard.test.ts)) cover only the single-write / idle-stream cases — not the stop-path interleave.

Direction (maintainer's call): decrement the counter **only when the ack is attributed `'untracked'`** (i.e., when the streamer has no unsettled acks). Under GRBL's strict receive-order guarantee, acks belong to the stream until its in-flight drains; the current "decrement always" trades a stuck-but-visible Start (1.5 s timeout message) for an invisible phantom refill.

### F2 — Welcome banner zeroes acks owed by post-reset writes; spontaneous mid-job reboot never terminates the stream — MODERATE

Two related behaviors of `handleWelcomeLine` ([laser-line-handler.ts:146](../../src/ui/state/laser-line-handler.ts)):

1. **Post-stop orphan acks.** `stopJob` writes the beam-off lines immediately after the soft-reset byte; on GRBL the boot banner typically arrives *after* those writes hit the wire. The banner zeroes `pendingUntrackedAcks` ("replies owed by the previous session will never arrive") — but the M9 write belongs to the *new* session and its ok is still coming. The orphaned ok is then attributed `'stream'`. Harmless against the cancelled streamer; a phantom refill if a fresh job squeezed into the window. Same class as F1, different trigger. (Whether GRBL swallows or acks bytes received during boot is firmware-dependent; the code should be safe under **both** outcomes, and today it isn't for the acked case.)
2. **Uncommanded reboot mid-job.** A banner arriving while `streamer.status === 'streaming'` can only mean the controller rebooted (commanded resets cancel the streamer first). The handler records detection and clears the counter but leaves the streamer streaming; the operator sees a live progress bar until the generic stall notice fires 10–90 s later ([laser-store-helpers.ts:116](../../src/ui/state/laser-store-helpers.ts)). LightBurn treats a mid-job controller reset as a job-ending event (not verified side-by-side this session). Safety impact is low (a rebooted GRBL boots beam-off); this is job-state honesty.

### F3 — Marlin/Smoothie jog is a 3-line payload but the ledger counts 1 ack (and the driver contract says "one line") — MODERATE

`buildMarlinJogCommand` / `buildSmoothieJogCommand` return `G91\nG0 …\nG90` ([marlin/commands.ts:32](../../src/core/controllers/marlin/commands.ts), [smoothieware/commands.ts:25](../../src/core/controllers/smoothieware/commands.ts)). The jog action writes it as **one** `safeWrite` ([laser-store.ts:317](../../src/ui/state/laser-store.ts)) and `owesTerminalAck` ([laser-safe-write.ts:95](../../src/ui/state/laser-safe-write.ts)) increments the counter **once per call** — the firmware acks three times. Two orphan oks per jog reach `settleUntrackedAck` with the counter at 0 and are attributed `'stream'`.

In the common flow the motion-operation Idle gate delays Start past the window, so this mostly self-masks — but the ledger invariant ("every queued write owes exactly one terminal ok/error", stated in three places) is structurally false on these drivers, and it feeds F1's early-zero behavior. Note also `ControllerCommands.buildJog` documents "Build **one** jog line (no trailing newline)" ([controller-driver.ts:52](../../src/core/controllers/controller-driver.ts)) — Marlin/Smoothie violate the seam contract. Either the contract or the drivers should change (e.g., return `ReadonlyArray<string>` and count per line).

### F4 — GRBL error-code table misdescribes errors 5, 10, and 17 — MODERATE (operator-facing recovery guidance)

[error-codes.ts](../../src/core/controllers/grbl/error-codes.ts):

- **17** detail says "Enable $32=1 for laser mode" — backwards. GRBL fires error 17 when a `$32=1` write is **rejected** because the build lacks variable-spindle PWM; the message tells the operator to do the thing that just failed. Official: "Laser mode requires PWM output."
- **5** fires when `$H` is issued with `$22=0` ("Homing cycle failure. Homing is not enabled via settings"). The table's detail ("Homing must be enabled before this setting is allowed") describes a settings write, not a homing attempt. **In-repo corroboration:** the project's own GRBL simulator implements exactly the correct semantics — `$H` with `$22 !== '1'` emits `error:5` ([grbl-sim-machine.ts:216](../../src/__fixtures__/controllers/grbl-sim-machine.ts), pinned by [grbl-simulator.test.ts:154](../../src/__fixtures__/controllers/grbl-simulator.test.ts) "refuses $H with error:5 when homing is disabled") — so the simulator and the operator-facing table currently disagree.
- **10** fires when enabling **soft limits** without homing ("Soft limits cannot be enabled without homing also enabled"). The table's "Set $22=1 to enable homing" is a workable remedy but names the wrong trigger.
- Nit: **30**'s title says "G53 with non-G0 motion" while its own detail (correctly) says G0 *or G1*.

Errors are stream-terminal and surface in the safety notice with these strings, so wrong guidance is operator-facing. Checked from memory of the gnea wiki — **re-verify against the wiki CSV before editing.**

### F5 — `pollDuringJob` is dead config — LOW-MODERATE (misleading state)

`StreamerState.pollDuringJob` ('off' | '1hz' | '2hz' | '4hz', default '4hz') is created and stored ([streamer.ts:52,71,95](../../src/core/controllers/grbl/streamer.ts), types in [grbl-streaming.ts](../../src/core/grbl-streaming.ts)) but **nothing reads it**: the poll loop uses its own fixed 250 ms / ÷4 cadence ([laser-connection-actions.ts:38](../../src/ui/state/laser-connection-actions.ts)), no profile field feeds it, no UI edits it, and the step-5b report never mentions it. Readers of the streamer state will assume polling honors it — including 'off', which would starve the stall watchdog if it were ever honored naively. Wire it or delete it.

### F6 — FluidNC skips the $30/$32 proof although its settings dump is collected — LOW-MODERATE (decision needed)

`runControllerReadiness` ([controller-readiness.ts:47](../../src/core/preflight/controller-readiness.ts)) early-returns "ok + power-scale-unverified warning" for every non-`grbl-dollar` capability. FluidNC is `'readonly-dump'`, and the connect handshake **does** run `$$` for it (settingsQuery inherited from the GRBL driver), so `controllerSettings` may hold real $30/$32 values that preflight then ignores. The comment lumps FluidNC with Marlin as "cannot prove", which contradicts the collected data. Either FluidNC's emulated numeric dump is untrusted (then say so in the comment/ADR) or the strict compare should apply when a dump was actually collected. ADR-094/095 don't resolve this. (Whether FluidNC's `$$` compat values are trustworthy is a firmware question I could not verify.)

### F7 — Smoothie status `F:` second component would be read as spindle — LOW (verify against real firmware)

`pickFsValue` ([status-parser.ts:187](../../src/core/controllers/grbl/status-parser.ts)) treats `F:` and `FS:` identically, mapping component 2 to `spindle`. Smoothieware's documented grbl-mode report uses `F:<feed>,<feed-override%>` — if that is right, the Laser window S readout ([StatusDisplay.tsx:38](../../src/ui/laser/StatusDisplay.tsx)) shows "S: 100" on Smoothie regardless of beam state. The in-repo smoothie simulator emits **no** F: field at all, so tests cannot catch it. Cosmetic; Smoothie is not hardware-verified anyway. Verify the wire shape before fixing.

### F8 — Ruida layer-color "BGR" conversion is an identity — LOW (experimental path)

`layerColor` ([rd-commands.ts:42](../../src/core/controllers/ruida/rd-commands.ts)) reads `blue = rgb >> 16` (which is the **red** channel of the 0xRRGGBB input), then repacks in the same order — `packed === rgb`, a no-op. Either the wire format is RGB (then the comment "BGR packed" and the shuffle are misleading) or it is BGR per the public decoders (then panel layer colors come out channel-swapped). The round-trip test can't catch it because the in-repo decoder mirrors the encoder. Cosmetic, EXPERIMENTAL surface, but the code contradicts its own comment — one of them is wrong.

### F9 — Marlin capability `wcs: 'none'` although Marlin supports G92 — LOW (parity decision)

[marlin/driver.ts:39](../../src/core/controllers/marlin/driver.ts) disables every set-origin workflow for Marlin profiles; Smoothie got `'g92-only'`. LightBurn supports user origin on Marlin via G92. ADR-095 is silent on the choice. If deliberate, document it; if not, `'g92-only'` looks cheap to enable.

### F10 — Marlin/Smoothie jog + frame omit units (no G21) — LOW

GRBL's jog builder emits `G21` in every line; the Marlin/Smoothie builders and frame legs never assert units ([marlin/commands.ts:32-53](../../src/core/controllers/marlin/commands.ts), smoothieware same). A machine left in G20 (console command, imported job) would jog/frame at 25.4×. Cross-driver inconsistency more than a likely field failure.

### F11 — Informational nits

- [alarm-codes.ts:91](../../src/core/controllers/grbl/alarm-codes.ts): comment says "11–13 are grblHAL extensions" — alarm **10** (E-stop) is also grblHAL-only; vanilla v1.1 ends at 9. Content fine, comment wrong.
- grblHAL's `Tool` status state is not in `GrblState`; such reports classify as `unknown` and are dropped. Only matters if CNC flows ever emit M6 (they don't today).
- grblHAL error codes > 38 arrive as `code: null` with raw preserved — degraded gracefully; ADR-094 covers alarms 11–13 but no grblHAL error-table delta exists.
- [resume-program.ts](../../src/core/controllers/grbl/resume-program.ts) tracks no G53/G28/G30. Own emitters never produce them (grepped `src/core/output`), but **imported external G-code** with `G53 G0 Z…` before the resume line records a wrong modal Z. Consider refusing G53 the way G91 is refused.
- `buildJogCommand` with all axes zero emits `$J=G91 G21 F…` (no axis word → GRBL error); Marlin's equivalent emits `G0 F…` (silent feed-only). Harmless; a guard would be cleaner.
- [detect-controller.ts:19](../../src/core/controllers/detect-controller.ts): any mid-session `unknown` line exactly equal to `start` flips `detectedControllerKind` to marlin (advisory-only; log noise).
- `laser-line-handler.ts` re-implements `appendLog`/`LOG_MAX` already exported as `pushLog` from laser-store-helpers — copy-paste duplication (CLAUDE.md anti-pattern list).
- Streamer byte accounting uses JS string length (UTF-16 units == bytes only for ASCII). Emitters are ASCII-only and `encodeWireBytes` throws on >0xFF, so a violation fails loudly at the port rather than corrupting counts — acceptable, worth knowing.

## What was checked and found correct

- **Realtime byte map** (0x18, 0x85, 0x90–0x9D overrides) matches GRBL v1.1; transport writes byte-per-char with a >0xFF guard and a pinned test (M12 fix confirmed in place).
- **Streamer**: terminal absorption (H5), error-terminal (P0-1), pause/resume drain semantics, oversize refusal (M13), ping-pong single-flight — all pinned by tests; `resume()` on a drained hold completes correctly.
- **Capability gating**: store guards read `capabilities`, never kind; the single GRBL `$J` literal in the CNC frame retract is ADR-098-justified and commented; probe and CNC gates encode real cross-grammar hazards (G4 P seconds-vs-ms, probe response grammar) and are pinned by grbl-family-drivers.test.ts.
- **Pause safety**: `!` hold requires `$32=1` proof on grbl-dollar lasers, exempts CNC (correctly inverted gate) and no-dollar firmwares per ADR-096.
- **Stop/error paths**: auto-stop after stream error sends reset + beam-off; error:9 echoes of our own shutdown are suppressed; `markErrored` vs `disconnect` distinction keeps Stop mounted (R-H2 lineage respected, including the functional-set race comments).
- **Guarded settings writer**: requires read-back rows + fresh backup + per-risk confirmation; $30/$31/$32 value validation is sane; console blocks $RST/$N/$I= (GRBL), M500/M502 (Marlin), config-set/load (Smoothie).
- **Detection is advisory** (log + state only, never a driver switch), matching ADR-094 §4; banner regexes order FluidNC before GRBL correctly.
- **Ruida**: swizzle matches the public algorithm and is round-trip property-tested; 35-bit/14-bit encodings match public docs; encoder refuses raster; UDP session is pure and unwired, profiles file-only — ADR-097 honesty upheld.
- **Preflight (GRBL path)**: exact $30 == profile maxPowerS compare, $32 required, $31 warning; CNC inversion ($32 must be 0, $30 == spindle RPM) present.
- **Exhaustiveness**: `selectControllerDriver`'s switch is compile-time exhaustive via `noImplicitReturns` (a new ControllerKind fails the build).
- **Simulator coverage**: grbl/marlin/smoothie simulators drive the real store in lifecycle tests; family test pins exactly which fields grblHAL/FluidNC may differ in.

## Test-coverage gaps worth closing (no code change proposed here)

1. F1/F2/F3 interleavings: stop-path acks racing a new Start (Marlin sim can express the delayed-ack case); banner-during-owed-ack; multi-line jog ack counting.
2. A smoothie-simulator status line carrying the real `F:feed,ovr` shape (once verified) so the parser assumption is pinned either way.
3. A fixture asserting `pollDuringJob` behavior — currently unassertable because it is dead (F5).

## Gate status (at audit time, before remediation)

- `pnpm typecheck`: PASS (`tsc --noEmit`, no output).
- `pnpm lint`: PASS (`eslint .`, exit 0).
- `pnpm test`: PASS — 603 test files, 3693 tests, 0 failures (335.8 s).

Per CLAUDE.md collaboration rule 2: a green suite proves structure and determinism, not wire-level fidelity against real firmware. The findings above are protocol/accounting reasoning from the code — none are contradicted by the suite because the suite does not exercise those interleavings (see "Test-coverage gaps").

---

## Remediation (2026-07-07, maintainer directive: "fix all")

Every finding was fixed the same day, one reviewed commit per finding, each with a failing-test-first where the finding was behavioral. Branch `claude/mystifying-nash-c2d3c1`:

| Finding | Fix | Commit |
|---|---|---|
| F1 double-counted acks | Counter settles only on acks the stream cannot own; `onAck('alarm')` and every commanded-reset path wipe in-flight accounting (`wipeInFlight`). New streamer + store-level attribution tests (Marlin stop, GRBL stop, stale-ok-cannot-advance-next-job). | `da286f2` |
| F2 banner races | Post-reset beam-off cleanup armed in refs and flushed by the boot banner (500 ms fallback); uncommanded mid-job banner marks the stream errored + new `controller-reboot` safety notice. | `f0935dd` |
| F3 multi-line ack counting | One owed ack per newline in `laser-safe-write`; `buildJog` seam contract comment corrected. | `ccecad4` |
| F4 error-code copy | 5/10/17/28/30 corrected against the gnea/grbl CSV (fetched and quoted this session, not from memory); pinned by `error-codes.test.ts`. | `19d4b01` |
| F5 dead `pollDuringJob` | Deleted from streamer state/options/type exports (wiring a real poll option would be feature work with its own ADR). | `d463c4c` |
| F6 FluidNC preflight | `readonly-dump` now verifies reported $30/$32 strictly; absent values downgrade to warnings (new `laser-mode-unverified` code); pause $32 proof extended to `settings !== 'none'` per ADR-096's stated rule. | `267161f` |
| F7 Smoothie `F:` spindle | Spindle only from `FS:`; smoothie simulator now emits the documented `F:feed,override%` field. Wire shape per Smoothieware docs, still not hardware-verified. | `211f564` |
| F8 Ruida layer color | R/B actually swapped; wire order pinned with byte fixtures. Still EXPERIMENTAL/unverified per ADR-097. | `acbb2ea` |
| F9+F10 Marlin WCS + units | Marlin `wcs: 'g92-only'` (G92 X0 Y0 / G92.1, community verification pending); G21 leads every Marlin/Smoothie jog payload and frame sequence. | `adec332` |
| F11 nits | grblHAL `Tool` state parsed; resume refuses G53/G28/G30; zero-axis jog guard on all builders; alarm-10 comment fixed; log-helper dedup. | `d3ae601` |

**Still NOT verified by this remediation:** everything hardware-shaped. The Smoothie `F:` format, FluidNC's compat-dump completeness, Marlin G92.1 availability, and the Ruida color byte order are all implemented per public documentation and simulator assumptions — the simulators now encode those assumptions explicitly, but only a real controller can confirm them (same evidence tier as ADR-095–097).

**Final gate status after remediation:**

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS (`eslint .`, exit 0).
- `pnpm test`: PASS — 604 test files, **3716 tests** (23 added by the remediation), 0 failures (286 s).
- No G-code output snapshots changed across the branch (verified `git diff main...HEAD` — no `.snap`/`__snapshots__` paths), so no snapshot-acknowledgment line is required.
