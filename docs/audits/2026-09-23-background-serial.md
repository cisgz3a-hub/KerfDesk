# Falcon background serial transfer repair

## Report and baseline

The operator reports that the Falcon pauses when Chrome is minimised and resumes when Chrome
is restored. This repair starts at main `04252e8a6e91cecb52cdf66217b80499b264825b` in an isolated
worktree. It follows the completed latest-100-PR repair, merged as PR #833; it does not reopen or
claim a new audit of another 100 PRs.

## Reproduced dependency

A real Chrome probe paces a simulated controller independently of the page and blocks the
window for two seconds. Both the ordinary transport and ADR-334's worker with transferred
window streams stall, although the controller clock continues. Stream transfer leaves the
source and sink algorithms in the realm that created the native port.

| Transport | G-code writes during the two-second window block |
| --- | ---: |
| Ordinary window-owned port | 1 |
| Worker using transferred window streams | 0 |
| Port and stream algorithms created inside the worker | 201 |

The permanent `e2e/native-serial-background.e2e.ts` uses the production native client, native
worker runtime, refill pump and main-side line handler with a worker-local simulated port. One
measured run sends 250 lines during the two-second block and delivers all 1,000 numbered G-code
lines exactly once in order. It verifies zero additional writes after release and successful
refill after re-arming. The test checks sustained progress late in the block, not merely bytes
already queued before it.

## Genuine minimisation probe

The independent Windows Chrome probe launches an owned clean profile and attaches Playwright
without its normal focus emulation. It verifies `document.hidden === true` and the visibility
transition after minimising the window. The simulated controller is paced by a Node HTTP stream
so window timers are not used as controller acknowledgements.

One valid run sends 525 ordered lines during 8.02 seconds genuinely hidden, with a maximum
observed write gap of 35.7 ms. The same run sends 131 lines during a two-second blocked window.
The worker is armed before minimisation and remains armed without release or invalidation.

Two subsequent native-worker repeats send 524 and 518 lines during 8.04 and 8.03 seconds hidden,
and 132 and 131 lines during their blocked-window intervals. Maximum controller heartbeat gaps
are 57.5 and 199.0 ms, below the probe's 250 ms validity bound. Both runs drain to zero pending
lines, send zero additional lines while explicitly paused, then re-arm and send 41 more ordered
lines. No duplication or loss appears in the expected G-code prefixes.

An earlier run is retained as **invalid controller-timing evidence**, rather than hidden: its
HTTP clock itself stops delivering for 4,810.4 ms and 2,614.2 ms, then delivers hundreds of buffered
ticks in under one millisecond. Those intervals match the observed write gaps; only eight
pending controller acknowledgements can be consumed at each catch-up. Aggregate tick counts
alone cannot establish continuous controller input. Later probes inspect heartbeat gaps as well
as counts. This limitation applies to the fixture, and does not establish that a physical Falcon
has or lacks a USB/firmware interruption.

## Repair and regression coverage

- The worker opens the already granted native port itself. Both sides verify a unique selected
  USB identity before open; ambiguous or unsupported cases retain the exact picked window port
  and display a visibility warning. An uncertain result after requesting native open never
  falls back to a second owner.
- Compatible GRBL-family profiles default to background streaming. Explicit opt-out survives
  machine-profile and project round trips; incompatible drivers retain the ordinary transport.
- Resume and tool-change Continue restore hosting after the accepted resumed window, while
  retaining connection, session, stream-generation, run and cancellation ownership. Three
  independent witnesses fail against the baseline action modules. The focused cohort passes
  87 tests in 11 files, including 19 new regressions.
- Startup and cleanup are bounded. Independent review found and reproduced stalled window
  enumeration, a throwing close observer, and unsolicited EOF waiting forever on stream abort
  or native close. The repair rejects writes during closing and waits for completed native
  cleanup or a deadline before terminating the worker. Final `closed` still means cleanup
  completed; early `native-closing` only starts the deadline. Reentrant requests join one close.
  A late refill-stop marker cannot revive a handover that closing already retired.

ADR-354 records the architecture and operator-facing behaviour. Focused checks cover native
selection/open/close, framing, handover, invalidation, preference persistence, Resume and
Continue. The permanent browser test is included in normal Playwright discovery.
The integrated focused run passes 331 tests across 40 files.

## Evidence boundary

No physical port, Falcon, air-cut or material job was operated. The worker-port fixture proves
software ownership, browser scheduling and byte order; it does not qualify adapter, cable,
firmware, laser output or motion timing. Browser shutdown, OS sleep and physical disconnection
remain interruptions. A completed Frame for the reviewed job remains the ordinary Start gate.

Raw local evidence is retained under
`D:\LaserForge\fix-background-serial-20260923-evidence`, including the independent baseline,
minimisation traces, the invalid clock trace, client lifecycle witnesses and baseline-red
Resume/Continue witnesses. PR checks provide the commit-correlated release and browser results.
