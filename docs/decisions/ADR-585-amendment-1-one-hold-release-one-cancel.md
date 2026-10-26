## ADR-585 Amendment 1 - One hold release sends one Cancel (2026-10-23)

**Status:** Accepted (rolling audit v2 finding 01-P2-6, rated PLAUSIBLE and reproduced again on
`main` before this fix; the maintainer's standing instruction to fix confirmed audit findings).
Amends ADR-585's hold-to-jog dead-man. | **Date:** 2026-10-23

### Context

ADR-585 says each way a hold can end (a late heartbeat, `jog_hold_stop`, the phone socket closing,
revocation, Abort) calls the existing `cancelJog()` for the motion the hold owns. It did not say how
many times. One routine release ran it twice:

- `jog_hold_stop` released the hold in the dead-man, which cancelled, and then cancelled again
  itself.
- The phone's release sends the socket `hold.release` and then `jog_hold_stop`, so the socket path
  cancelled first and the stop cancelled again.

The second `cancelJog()` replaced the first. The first then rejected ("replaced before its
confirmation completed"), and the hold's receipt became terminal `unknown`: "The held jog stop could
not be confirmed. Check the machine on the PC." When the second Cancel settled, the receipt changed
to `completed`, "Stopped.". The machine stopped normally and only one `0x85` reached it.

A simulated GRBL that decelerates for 150 ms after `0x85` showed the false `unknown` for about
190 ms after `jog_hold_stop` alone, and for about 150 ms after socket release plus stop. The phone
reads the receipt every 600 ms and stops at the first terminal state. So about one routine release
in three left a warning toast on the phone and stopped the phone following the receipt. A longer
real deceleration widens the window.

### Decision

1. **One native Cancel per owned motion.** `cancelOwnedMotionOnce` sends the Cancel for the
   operation's motion and records that motion id on the operation. Later stop requests for the same
   motion send nothing. This covers `jog_hold_stop`, the socket release, the dead-man timer, the
   check after the jog is dispatched, and grant loss or Abort (`cancelMachineOperation`). Whichever
   comes first sends the Cancel.
2. **A replaced Cancel is not a failed stop.** If another Cancel took over the same motion on the
   same controller session (for example, the operator's Cancel on the PC), the rejection does not
   mark the receipt. This is the store's own test: a live Cancel attempt owns the motion's status
   boundary. The desktop treats its own replaced attempt the same way. The receipt then settles as
   before: Idle completes it as "Stopped.", and a settlement that never arrives still fails it.
3. **A real failure still warns.** If the one Cancel fails and nothing else is settling the motion
   (a write error, an MPG takeover, a controller change), the receipt still becomes `unknown` with
   the same message.

### Consequences

- A routine phone release no longer shows a false warning. Stop paths that only repeat a release
  are free.
- A failed Cancel is not retried by a later release of the same hold. This is unchanged: the failed
  Cancel already left the receipt terminal, and terminal holds were never cancelled again.

### Verification

- `machine-hold-release-once.test.ts` drives the real registry and the store's `jog` and `cancelJog`
  against a fake GRBL that decelerates for 150 ms. `jog_hold_stop` alone, and socket release followed
  by `jog_hold_stop`, each send one Cancel. The receipt never shows `unknown` and ends
  `completed | Stopped.`. Before the fix both cases sent two Cancels and showed `unknown`.
- `machine-hold.test.ts`: every stop path together sends one Cancel. A Cancel replaced by another
  leaves the receipt running. A Cancel that fails on its own still reports the unconfirmed stop.
- No hardware was operated. The deceleration window on real machines is still unmeasured.
