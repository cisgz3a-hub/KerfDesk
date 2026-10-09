# Rolling audit — CNC WCS-at-connect (C6, PR #241) + recovery wire-boundary re-validation (PR #242)

- **When:** 2026-07-17 01:46 (+08)
- **Tree:** `d7125728` (main tip at audit time)
- **Scope:** the two most recent code commits — `3e85f7b1` (#241, ackless `$G` at connect → `store.activeWcs`) and `dbe90e4a` (#242, retained-WCO re-check at the recovery wire boundary) — plus the modules they compose with (`laser-line-handler`, `laser-controller-handshake`, `laser-safe-write`, `laser-stream-ack`, `laser-controller-qualification`, `cnc-pass-recovery-*`, `cnc-supervised-recovery-stream`, `work-offset-readback`).
- **Method:** static read of the current tree only. **Not verified:** no hardware, no live controller, no tests executed this iteration.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P2-1 — `activeWcs` survives every controller reset boundary stale, and is never re-read after one

The C6 advisory's backing state goes wrong on any mid-session controller reset — including the *commanded* resets the app itself performs (Stop, auto-stop), which produce a welcome banner in ordinary use.

Evidence:

- The banner reset patch clears `wcoCache`, `ovCache`, `statusReport`, `accessoryCache`, homing state, etc., but **not** `activeWcs` — `src/ui/state/laser-line-handler.ts:214-242` (`handleWelcomeLine`).
- A fresh *connect* does clear it (`src/ui/state/laser-connection-actions.ts:189`), and the connect handshake re-reads it via the ackless `$G` (`src/ui/state/laser-controller-handshake.ts:214,225-242`). But that read is reachable **only** from `runControllerHandshake` (connect path).
- Post-banner re-qualification runs `refs.runControllerQualification = settingsActions.readMachineSettings` (`src/ui/state/laser-store.ts:453`, scheduled from `laser-line-handler.ts:251`), which re-reads `$$` settings only — no `$G` is ever re-issued after a reset.
- The store *does* track operator WCS changes sent through the console (`src/ui/state/laser-console-actions.ts:192`), so the stale path is live in both directions:
  - **False warning:** operator selects G55 via console → `activeWcs = 'G55'` → Stop (soft reset) → GRBL re-initializes its parser to defaults / `$N` (G54) → the C6 warning (`src/ui/laser/active-wcs-warnings.ts:18-25`) keeps claiming the controller has G55 selected at every Start until reconnect.
  - **Missed warning:** a `$N` startup block that re-selects G55 runs again on the reset, but the store keeps whatever it last saw (e.g. G54) — the exact case C6 exists for, invisible again after any mid-session reboot/watchdog reset.
- Contrast: the ALARM handler also leaves `activeWcs` alone (`laser-line-handler.ts:303-341`) — that one is *correct*, since a GRBL alarm does not reset the parser; only the banner boundary is the gap.

Consequence: advisory-only (no blocking behavior), but it corrupts precisely the signal #241 was built to provide, in a scenario (Stop → restart job) that occurs in normal operation.

Direction if fixed (maintainer's choice): clear `activeWcs` in the banner patch, and/or re-issue the ackless `$G` after post-reset re-qualification completes (the quiescent-ledger precondition holds at that point for the same reason it does at connect).

---

## P3-2 — the ackless `$G` quiescence guard is write-time only; a command entering the in-flight window can be mis-settled (the F1 class the guard itself cites)

- Qualification flips to `qualified` the moment the settings response lands (`publishDetectedSettings`, `src/ui/state/laser-line-handler.ts:151`) — which is what unblocks operator commands — and only *then* is the `$G` written (`laser-controller-handshake.ts:240-241`).
- The guard `if (get().pendingUntrackedAcks > 0) return;` (`laser-controller-handshake.ts:240`) checks the ledger only at write time. A normal (non-ackless) write landing **after** the `$G` write but **before** its `ok` increments the ledger (`src/ui/state/laser-safe-write.ts:82,88-91`).
- GRBL answers FIFO, so the `$G`'s unaccounted `ok` arrives first and `settleUntrackedAck` (`src/ui/state/laser-stream-ack.ts:36-39`) settles the *later command's* ack. That command's real `ok` then arrives against a zero ledger and is routed as `'stream'`-owned.
- Worst-case chain: the `pendingUntrackedAcks === 0` Start fence opens one ack early; if a streamer exists by the time the stray `ok` lands, `advanceStream` phantom-advances one line. With no streamer mounted the stray `ok` is a no-op (`advanceStream` returns on `streamer === null`).

Likelihood is very low — the window is one controller round-trip immediately after qualification, and requires an operator write inside it — but the mechanism is exactly the F1 mis-settle the code comment warns about, guarded only at one instant. Worth a look if the ackless primitive ever gains a second caller (the risk compounds per call site).

---

## P3-3 — no ADR for the ackless-write primitive

`SafeWriteOptions.ackless` (`src/ui/state/laser-safe-write.ts:23-32`) is a new cross-cutting controller-I/O contract: it changes what the untracked-ack fence means for every future caller, with a subtle caller obligation ("MUST issue it only against a quiescent ledger") documented only in a code comment. `DECISIONS.md` has no entry for it (grep for "ackless" — no hits; the only `$G` entries are the Work-Z owned-readback ADR). PR #241's commit message cites the C6 audit residual but no ADR. Per CLAUDE.md's feature checklist ("If it's architectural, is there an ADR?") this warrants a short ADR so the quiescent-ledger precondition is discoverable by the next caller.

---

## Verified clean (checked, no finding)

- **#242 wire-boundary re-check:** `assertFinalStartConditions` is composed after the generic recovery assertion, synchronous, and runs before streamer creation (`src/ui/laser/cnc-supervised-recovery-stream.ts:69-76`); on throw, `resolveFailedRecoveryAttempt` takes the `streamer === null` branch → `cleanupRejectedRecoveryAttempt` → capsule stays retryable, matching the commit's claim.
- **ADR-206 guard governance for #242:** the re-check does expand a refusal surface, but the commit quotes maintainer approval ("Approved audit finding 3, 'fix 1-5'") and re-runs an existing predicate with the existing message at a later boundary — compliant.
- **`finalRecoveryStartAssertion`** re-reads live store state; the pre-staging snapshot is only the prepared-against baseline (`src/ui/laser/recovery-start-authorization.ts:10-27`). Not a stale-snapshot bug.
- **`parseActiveWcsFromModalResponses`** requires exactly one `[GC:]` body and exactly one G54–G59 word, anchored regexes, substring pre-filter keeps the job-stream `ok` flood off the regex (`src/core/controllers/grbl/work-offset-readback.ts:50-55`, `laser-line-handler.ts:106-112`). Robust.
- **GRBL-only as claimed:** `modalStateQuery` is `null` for Marlin, Ruida, Smoothieware (`src/core/controllers/{marlin,ruida,smoothieware}/driver.ts`).
- **Retained-WCO tolerance** 0.005 mm vs GRBL's 3-decimal reporting (`src/ui/laser/cnc-pass-recovery-review.ts:13`) — sound.

## Not verified

- No hardware or live-controller behavior; both PRs are themselves flagged "not hardware-verified".
- Test suite not run this iteration (static audit only); no lint/size checks run.

---

## Addendum (2026-07-17 04:45, discovered while implementing the approved P2-1 fix, PR #260)

### P3-4 — the `ackless` option is silently dropped by the production safeWrite wiring

- `laser-connection-actions.ts:60-64` declares its own 3-param `SafeWriteFn` (no `options`), and the store wires every action group with 3-arg lambdas (`src/ui/state/laser-store.ts:456-457`) over a 3-param `safeWrite` wrapper (`laser-store.ts:297-305`). TypeScript permits narrower-arity assignment, so the handshake's `safeWrite(line, undefined, 'system', { ackless: true })` compiles — and the 4th argument evaporates before reaching `createSafeWrite`.
- **Production consequence:** the `$G` modal read is written as a normal owed-ack line (1 reserved, 1 settled — accounting stays balanced), so behavior is benign; but the merged #241 ackless design — and the quiescent-ledger guard motivating it — is inert in production. PR #260's re-qualification readback inherits the same dropped option (deliberately, to match).
- **Test blind spot:** `laser-controller-lifecycle.test.ts:175-209` exercises the real store and asserts only the *settled* ledger (`pendingUntrackedAcks === 0` after the ok), which an owed-and-settled ack also satisfies — the test cannot distinguish ackless from owed, so it stays green either way. `laser-safe-write-epoch.test.ts:184-213` tests the ackless mechanics but calls `createSafeWrite` directly, bypassing the store wiring.
- **Decision for the maintainer** (both are small):
  1. Plumb `options` through the store wrapper and the action-module `SafeWriteFn` types so the ackless design actually holds — noting this *activates* finding P3-2's write-time-only race window; or
  2. Delete the ackless mechanism and let the `$G` owe its ack normally — the fence handles it, no F1 class exists at all, and the quiescent-ledger comments go away. (Simpler; recommended.)
