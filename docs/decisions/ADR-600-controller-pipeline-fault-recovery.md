## ADR-600 - Preserve command ownership through controller faults and Abort (2026-10-16)

**Status:** Implemented on the audit repair branch; verification recorded in the linked audit.
**Date:** 2026-10-16

Amends the fault paths of ADR-354/361/375 and Marlin reply/Abort handling of ADR-395.
The Frame policy in PROJECT.md non-negotiable 21 and ADR-565 is unchanged.

### Context

The all-family G-code pipeline audit reproduced four faults on
`f7e2a36895b67cfa33be03c16e6c19e7c6722d14`:

- A delayed Marlin stop write left normal job refill active after Abort began.
- Marlin handler `Error:` followed by its normal `ok` retired two reply owners.
- Recoverable serial receive failure discarded a prefix but accepted its suffix as a new
  record, allowing a damaged `:ok` response tail to become a stream acknowledgement.
- Writer close raced a timeout, but its fallback abort could remain blocked by the same
  underlying close/drain indefinitely.

The reproductions, equal-family coverage, primary references and evidence boundaries are in
[the audit](../audits/2026-10-16-controller-pipeline-audit.md).

### Decision

1. Abort stops host refill synchronously before awaiting worker handback or queued stop writes.
   The stop transaction snapshots any needed air-off commands and retains exclusive operation
   ownership while its asynchronous writes are underway. In-flight commands still own their
   replies. A successful write does not prove physical stop or accessory-off.
2. Firmware response semantics determine when a reply owner is retired. A non-halting Marlin
   handler error stops new job transmission immediately but preserves the refused command's
   pending terminal response. Its following `ok` belongs to that command, never to cleanup.
   Owned interactive exchanges retain the error until the terminal response, then reject.
   GRBL `error:N`, Marlin kill, resend and unknown-command paths retain their separate contracts.
3. After a recoverable receive failure, readers discard uncertain bytes through the next
   record delimiter, then resume complete-record dispatch. They retain the writer for Stop and
   never synthesize or replay a lost acknowledgement. The window and worker paths obey the
   same framing rule.
4. Caller-facing shutdown is bounded even when close, abort or native close does not settle.
   Actual cleanup retains ownership until it really finishes. A timeout is not permission to
   acquire another writer for a still-closing selected port. Worker termination remains the
   existing ownership boundary on the native-worker path.

### Verification and limits

Focused regressions use the real queue, line handler and stop action with delayed writes and
interleaved replies; receive-error tests exercise both readers and armed worker refill.
A real WHATWG WritableStream models stalled underlying close/drain, instead of a fake writer
whose abort always resolves.

These changes repair software state and byte ordering. They neither qualify a firmware build
nor establish stop latency, beam-off, spindle-off, interlock wiring or real cutting behavior.
No hardware is operated by these tests. No controller settings, output power policy, Frame
policy or licence policy is changed.
