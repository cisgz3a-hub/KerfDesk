# September 21 PR audit repairs

The audit reviewed PRs #801–#822 and Claude follow-up commits in #797, #799 and #800
against main `377e692baf26a9f66ba3877f157213095c54b92f`. These changes repair its confirmed
findings and the related worker and cancellation defects exposed during regression testing.
The tutorial change is a separate commit on PR #822 because that feature branch is not in main.
PR #821 merged during verification; its browser and cancellation follow-ups are included here.

| Finding | Repair and regression evidence |
| --- | --- |
| #811 duplicate worker refill | A prepare/ready barrier drains earlier inbound lines before sampling current stream state. Renderer suppression starts before arm. Correlated release and cancellation cannot resurrect stale ownership; a handshake timeout closes the connection. Real-core/store and real-browser transferable-stream tests cover both sides of each boundary. |
| #816 stranded pending Start | Reconciliation reads immutable artifacts without requiring terminal history, verifies identity/integrity, preserves exact versus stand-in kind, and binds the transition to the observed pending Start. Memory and IndexedDB crash-window and concurrent-replacement cases cover subsequent Start as well as the restored capsule. |
| #807 newer autosave deleted | Retirement compares the observed local bytes or uses the observed IndexedDB epoch. Two interleaving tests write valid replacement backups while the original recovery read is suspended. |
| #806/#810 detailed contour budget | Both optional plan construction and packed-route selection count edges inside cut polylines. A large contour can no longer count as one segment. Geometry remains authoritative. |
| #811 Marlin transcript growth | Fixed-size rings bound pending history to the existing retention caps. Job-only arrivals also publish after the 250 ms batch deadline without requiring a queued status response. A real Marlin line-handler/poll-policy regression covers 2,001 acknowledgements. |
| #817 false burn display | Hot indication requires an active, unambiguous process position; off/terminal/travel states keep an ordinary marker. Cooling bands split at route-distance boundaries, preserving the same ramp for equivalent segmentations. |
| #822 closed tutorial history | Closing clears the retained lesson id. A real host test opens a different contextual lesson and verifies Escape returns to the library, then closes. Pushed separately as `b75eff174`. |
| #799 uncertain dwell fallback | Exact and fallback estimates share the controller dwell-evidence predicate. A size limit or absent position cannot turn uncertain dwell units into a numeric estimate; offline, proven-controller and no-dwell controls remain available. |
| #805/#818 Release motors mismatch | The guide and Release control use the same XY-origin predicate. Zero Z alone leaves one Release surface; Reset/Clear remain all-axis. |
| #820 overclaimed copy test | The test and comments now describe measured slice/reverse avoidance while explicitly retaining per-candidate ring allocation. Geometry code is unchanged. |
| #821 browser failure | The worker's silence limit is checked independently from total work and preview rendering. Output and committed-geometry assertions remain, alongside responsiveness and cancellation checks. |

Additional #811 regressions cover reboot banners, MPG takeover, Alarm/Sleep status, outbound
reset and failed writes. These events retire worker refill before subsequent acknowledgements.
The real store processes the invalidating line before accepting refill ownership again.
Worker streaming is available only to GRBL-family drivers; a saved opt-in cannot select the
GRBL-only pump for Marlin or Smoothieware.

The trace Cancel test also exposed a native worker that outlived its closed dialog. Its repair
binds cancellation to the owning preview request, preserving newer replacement work.

## Validation

- The complete trace test group passes: 339 tests across 40 files, including request-owned
  cancellation, replacement ownership, region adapters and prepared-preview commits.
- Seven Chrome tests exercise the production serial module Worker and actual transferable
  streams: handover boundaries, fragmented lines, release timeout and invalidating events.
- Two Chrome checks on the isolated #821 head pass: Sharp dragon tracing with unchanged output
  and committed-geometry assertions, and cancelling an actively heartbeating native worker.
- Web build (including TypeScript), E2E TypeScript, repository ESLint and formatting pass.
  ADR numbering, file-size and public-export checks pass; the soft-size report is advisory.
- The separate #822 tutorial fix passes 17 focused tests, TypeScript, lint and formatting.

## Validation boundaries

Focused regressions use production preparation, persistence, stream, parser and renderer paths.
Browser worker tests transfer actual streams to the production module Worker with a simulated
port. IndexedDB interruption tests use the production backend over fake-indexeddb.

No physical serial port, controller, Frame, air cut or material job was operated. The worker
feature remains experimental and off by default. The sole ordinary Start policy gate remains
a completed Frame for the exact reviewed job. No merge or deployment is part of this repair.
