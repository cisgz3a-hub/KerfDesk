## ADR-657 - Remote Set origin and Zero Z keep the PC guards, definite refusals stay definite, and a failed revocation save fails closed

**Status:** Accepted; unit- and workerd-tested, not hardware-tested. | **Date:** 2026-10-21

### Context

The 2026-10-21 rolling audit of remote control
(`docs/audits/2026-10-21-rolling-v2/01-remote-control.md`) confirmed four P2 findings.

- **01-P2-1.** ADR-585 maps `set_work_origin` `z` to `zeroZHere()`. The PC's Zero Z button first
  runs `zeroZOverwriteWarning` (`src/ui/laser/zero-z-guard.ts`), which asks before a parked bit
  (the post-probe retract, the post-Frame safe Z) replaces an established work Z0. The remote
  called the store action directly, so a phone tap could silently move a probed Z0 by the retract
  height and the next CNC job would cut at the wrong depth.
- **01-P2-2.** ADR-327 item 4 says Set origin changes Start from Absolute to User Origin. The PC
  does this in `OriginRow.tsx`; the remote called only `setOriginHere()`, so Frame and Start kept
  running at the drawn bed position.
- **01-P2-3.** ADR-569 keeps "outcome uncertain" for a lost result. The relay
  (`services/remote-control/src/device.ts`) turned every desktop error for a machine command into
  an `unknown` receipt that says "do not repeat", including refusals the desktop makes before it
  owns any operation (`stale_revision`, `busy`), and replayed it forever.
- **01-P2-4.** ADR-564 says disabling access durably queues revocation before it can reconnect. If
  the encrypted save failed during Disable, Revoke or Revoke all, the revocation was never sent,
  the old record stayed on disk and reconnected on the next launch, and the save error was
  overwritten by "The computer is offline. Remote access will reconnect automatically."

### Decision

1. **Remote Zero Z is refused wherever the PC would ask to confirm.** A phone or MCP client
   cannot answer the PC's native confirmation, and adding a confirm argument would let a client
   skip a question about physical stock it cannot see. `executeOrigin`
   (`src/ui/remote-control/machine-actions.ts`) reads the same live warning as the PC
   (`liveZeroZOverwriteWarning`) and, when it is not null, fails the operation before writing
   anything, with the fixed `REMOTE_ZERO_Z_REFUSAL` text: touch the bit to the stock top first, or
   use Zero Z on the PC. A first zero, or a correction within 0.5 mm of the established zero, is
   written as before.
2. **One helper applies ADR-327 item 4 for both paths.** `placementAfterSetOrigin`
   (`src/ui/laser/set-origin-placement.ts`) upgrades Absolute to User Origin after the controller
   confirms, only in the document where Set origin began (its document epoch), and never rewrites
   User, Verified or Current Position. The PC Origin row, Set persistent origin and the remote XY
   Set origin all call it; the remote passes the epoch its operation was admitted in.
3. **A definite desktop refusal of a machine command stays a refusal.** The MCP error set gains
   `busy` ("The desktop is busy with another action. Wait for it to finish, then try again."),
   which the desktop route now sends instead of folding busy into `unavailable`. When the
   desktop's own reply to a control command is `stale_revision`, `invalid_input` or `busy`, the
   relay passes that error through and tombstones the ledger ID with the code: a replay of the same
   ID returns the same refusal and is not dispatched, and `get_control_operation` reports it as
   `failed` with `committed: false`. Every other reply (`unavailable`, `cancelled`, `failed`),
   relay timeouts and lost connections keep the `unknown` receipt, because they can follow
   dispatch. The phone app, legacy control page and MCP App have text for `busy`.
4. **A revocation that cannot be saved fails closed across a restart.** When the save fails
   during Disable, Revoke or Revoke all, the runtime (`electron/remote-access/runtime.ts`) sends
   the revocation to the relay if it is still connected, then deletes the saved record
   (`discard()`, which needs no secure storage), so the old pairing can never reconnect; remote
   access stays shut until KerfDesk restarts and must be set up and paired again. If the record
   cannot be deleted either, the status says that phones may reconnect after a restart and to use
   Revoke all connections. A storage failure's message is no longer overwritten by the offline
   text when the relay closes. The relay stays authoritative: a revocation it received holds
   regardless of the local file.

### Consequences

- An operator who Zero Z's from the phone with the bit parked above an established zero gets a
  refusal and must lower the bit or use the PC. `get_machine_status` still reports origin as
  available; the refusal comes on the operation receipt.
- MCP clients see one new error code. An older relay that does not know `busy` reports it as
  `failed`, so mixing versions only degrades the text.
- A storage fault during revocation costs the user their pairings, in exchange for no revoked
  client regaining access.
- 01-P2-5 (hold releases spending the Abort rate allowance) and 01-P2-6 are not changed here.

### Verification

`src/ui/remote-control/machine-origin.test.ts` (Zero Z refusal and pass cases, Absolute upgrade,
explicit choice kept, failure and document-change cases), `electron/remote-access/runtime.test.ts`
(each revocation path with a failed save, a failed delete, and a failed post-confirmation save),
`electron/remote-access/credential-store.test.ts` (`discard`), and
`services/remote-control/test/control-ledger.test.mjs` (real workerd: refusals pass through, replay
the same refusal without dispatch, and look up as failed; `unavailable` stays unknown).
