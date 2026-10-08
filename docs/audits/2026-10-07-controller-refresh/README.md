# Controller connection recovery audit and fix

The app keeps a usable controller connection through Abort and controller
information recovery. Job interruption, stale controller information, response
ownership, and loss of communication have separate causes and separate guidance.
A retained warning alone no longer asks the operator to replace a healthy port.

This change was carried onto current main
`76b5ff53e3be7df6c160a8b26820e61188595f08` in an isolated checkout on
7 October 2026. The maintainer requested implementation, a test audit, and a PR.
The original working tree and its unrelated work were preserved.

## Why the bar appeared

Abort already sent the firmware reset through the open connection. Reset cleared
current controller evidence, but the information-refresh scheduler and serial
reply owners did not always converge afterward. The UI could offer Retry while
the read was still blocked, and a historical safety warning could suggest
Reconnect despite current communication. Some warnings described successful
containment without the corresponding stop action. Hiding the bar would have
left those defects intact.

| Reproduced finding | Resulting behaviour |
| --- | --- |
| Missing reset greeting could strand information refresh. | The store schedules recovery after session invalidation as well as startup replies. It uses the existing port when cleanup, response/write ownership and fresh current-session Idle permit. |
| Retry could be offered when the settings read could not run. | UI and store use the same readiness gate, show the waiting reason and check again on the actual click. Responsive Alarm/Sleep waits; silence and an empty/rejected dump remain distinct failures. |
| A CNC transition timeout suggested replacing the connection. | The warning remains nonterminal and retains the paused job and saved artifact. A later Abort, actual Disconnect or fault records its own terminal cause. |
| An acknowledgement-stall warning could claim containment without performing it. | Host refill is frozen before reset or best-effort off delivery. Existing dwell, fresh-Run, firmware-busy and scheduler-gap suppression remain. Late replies cannot refill the abandoned job. |
| A reboot during final settlement could appear successful. | A reboot before the drain marker and stable Idle settlement records interruption, even when all job lines were acknowledged. |

Normal completion and Pause/Resume without a controller reset retain connection
and information. The existing CNC Pause and lift uses reset, so it refreshes
information over that connection. Required refreshes read information; they do
not write controller settings, unlock, home, or resume an interrupted job.

## Ownership repairs found by the test audit

The port has one commanded reset owner shared by Abort, controller-error reset,
stall containment and Disconnect. Reset-byte acceptance and a later Idle report
cannot discard old response debt. A recognized reboot supplies the causal
boundary. Transport writes crossing that boundary retain their own fence.

The audit also reproduced and fixed these races:

- Alarm/Sleep could detach the reset owner while cleanup writes were still pending.
- Failed cleanup could remain registered, causing a later explicit Abort to join
  an already failed transaction.
- A rejected reset or missing greeting could skip the existing bounded M5/M9
  best-effort delivery. Delivery is restored without claiming physical beam-off
  or releasing the response fence; a later boot triggers fresh causal cleanup.
- A boot arriving while an earlier off write was pending could assign anonymous
  replies to the new cleanup. That ambiguity now remains fenced until a stable
  causal boundary.
- Old Wake continuations could clear a newer operation after awaiting cleanup.
  Both Alarm branches now check the private owner after that await.
- A failed canonical Wake could retain a completion lease forever. It releases
  the failed lease while leaving unresolved reset/cleanup ownership intact.
- A second Abort could forget a prior ambiguous reset after counters reached
  zero. Remembered causal uncertainty survives those anonymous replies.
- Delayed hosted-queue release could clear a newer completed Frame. The release
  applies only to its own operation generation.
- Reconnect closure could resurrect a warning acknowledged during the pending
  close, or attribute a new close failure to the old incident. The acknowledgement
  remains effective and a new failure receives its own notice.
- A live Forget could retain a stale Fire incident after successful cleanup or
  replace Marlin's unconfirmed physical-stop advice with that historical cause.
  Successful live Forget clears the stale incident; unresolved or newly raised
  warnings remain, including genuinely halted firmware that accepts transport
  writes but cannot execute them.
- Publishing a controller-error or Resend terminal state before its reset-risk
  metadata could archive a false position-preserved checkpoint. Reset risk now
  accompanies the first terminal snapshot while host output is already frozen.

The current-main contracts remain: ADR-565 reusable spatial Frame evidence,
exact one-use execution claims, remembered-port and worker-streaming options,
controller-specific stopping, and durable first-terminal checkpoint ownership.
A successful information refresh does not revoke valid Frame evidence. A real
reset revokes the relevant evidence before another motion can be dispatched.

The governing change is
[ADR-212 Amendment 1](../../decisions/ADR-212-amendment-1-existing-connection-recovery.md).
Operator behaviour is recorded in the controller qualification section of
[WORKFLOW.md](../../../WORKFLOW.md).

## Other senders

Official documentation and source distinguish recovery over an open port from
closing and reopening it:

| Sender | Primary evidence and limit |
| --- | --- |
| LightBurn | [Laser Window](https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/#devices) separates Stop/Pause from explicit Devices reconnect; [Machine Settings](https://docs.lightburnsoftware.com/latest/Reference/MachineSettings/#read) describes Read. Its private wire implementation and automatic read cadence were not established. |
| LaserGRBL | [Pinned GrblCore source](https://github.com/arkypita/LaserGRBL/blob/1f9337b3af27133f8b1696e41cc110f2af74d04f/LaserGRBL/Core/GrblCore.cs) sends manual reset through the open port; CloseCom is separate. Its inspected base Abort/startup paths do not schedule a full settings read. |
| UGS | [GrblController](https://github.com/winder/Universal-G-Code-Sender/blob/master/ugs-core/src/com/willwinder/universalgcodesender/GrblController.java) sends soft reset through the existing communicator. Initialization and its failure handling remain separate; this is not a claim about every post-reset read. |
| gSender | [GRBL backend](https://github.com/Sienci-Labs/gsender/blob/master/src/server/controllers/Grbl/GrblController.js) sends forced Stop/reset through the open port; startup initializes when not initialized or settings are missing. The current UI caller was not independently retrieved. |
| bCNC | [Generic controller](https://github.com/vlachoudis/bCNC/blob/master/bCNC/controllers/_GenericController.py) soft reset and purge use the existing serial connection. Purge refreshes parser/coordinate information; its unlock and modal restoration are not adopted here. |

This is the research snapshot checked on 7 October 2026. Except for pinned
LaserGRBL, upstream branches and online documentation can change. No installed
competitor runtime or physical machine was qualified. The comparison supports
keeping a usable port, rather than copying every sender's stopping behaviour.

## Verification

The full repository suite passed on the implementation snapshot based on `76b5ff53e3be7df6c160a8b26820e61188595f08`: **27,785 tests passed**, 29 skipped/pending and 0 todo across 3,578 files. There were no failed tests or runner-error suites. The source guard checked 7,891 source/config files before and after the run: zero changes. The compact [current-main verification](verification-current-main.json) records the counts, source-manifest hash and build asset hashes.

TypeScript, the repository lint check, formatting, the production renderer build,
file-size limits, ADR numbering and the privacy check passed on the integrated
source. The generated browser-Free renderer contains the three recovery messages;
all seven local HTML references resolve, and its service worker and manifest exist.
These checks do not establish installer or hosted-CI results.

Local verification used Vitest 4.1.11 and the current-main dependency lock. The
private test configuration only gives Vite access to the NTFS dependency junction
and a private cache; it retains the repository setup, discovery and worker policy.
Lint excludes the ignored local evidence directory containing disposable fault
harnesses. No production dependency, test or lint configuration changed.

The test review also checks real-store and mounted-control outcomes: wire writes,
port requests, retained paused state and durable checkpoint metadata. Stale-click
cases act before React updates. Reset fixtures finish their bounded cleanup before
clearing or changing fake clocks; discarded replies and delayed transport writes
are exercised explicitly. The existing fresh-Run, dwell and firmware-busy
allowances remain covered.

The broad run exposed three outdated fixtures: desktop closing compared an old
public recovery phase and leaked a pending Wake on assertion failure; response
presentation erased job replies before a reboot; status polling never answered
the newly resumed settings read. Repairs preserve the original ownership and
close-approval outcomes, then verify genuine boot/cleanup replies and successful
automatic refresh. All 19 affected tests pass together with no unhandled error.
The failed diagnostic run is retained locally and excluded from final pass credit.

The first PR browser-CI run exposed an outdated successful-Abort fixture in
`e2e/production-workflows.spec.ts`: it sent Ctrl-X without a recognized reboot,
so a legitimate recovery warning remained beside Alarm 3. The failure was
reproduced locally. That scenario now supplies its own prompt reboot, acknowledges
only the new M5/M9 cleanup and waits for full information refresh over the same
port before exercising Alarm recovery and actual Home. The final assertions also
finish Home's modal-state readback, require current-session homing and zero reply
or write debt, and retain the absence of all alerts and the Frame/Start outcome.

The repaired Chrome workflow and a cold-start browser test both passed. The
[compact browser evidence](browser-ci-repair.json) records their separate counts,
the exact test-source hash and the integrated main revision `e3820ed51`.
Intermediate diagnostic failures receive no pass credit. These focused browser
checks supplement the historical full-suite evidence; they do not replace it.

The final [bounded fault audit](mutation-audit-current-main.json) ran in a separate
source copy. All 76 selected tests passed before and after the six fault injections;
7,827 compared source/config files had no differences from the PR checkout.
Only assertion failures count as detecting a fault. There were no invalid runs.

| Deliberately introduced fault | Result |
| --- | --- |
| Remove the reconnect click-time check. | Detected: two assertions expose a second port request. |
| Remove one reset-time Frame revocation guard. | Survived: the production session-invalidation subscription still revokes Frame proof, and Start also validates the session epoch. No observable contract breach was demonstrated. |
| Advance the Alarm/Sleep write epoch while cleanup owns a pending write. | Detected: two assertions expose detached write ownership. |
| Retain an already failed cleanup transaction for the next Abort. | Detected: two assertions expose a missing new reset or reuse of the old private owner. |
| Skip the observed-Alarm Wake caller's ownership check after awaiting cleanup. | Detected: a superseded Wake incorrectly completes as Alarm. |
| Skip best-effort off delivery after an unconfirmed reset. | Detected: 18 assertions expose missing off attempts and their resulting ownership failures. |

Five of the six selected faults were assertion-detected. This is a bounded audit,
not an exhaustive mutation score or a coverage percentage. Overlapping focused
runs are not added together. The interrupted pre-extraction audit is excluded
from final credit. Raw logs remain local. The historical
[test-quality.json](test-quality.json) records earlier fault checks against the
original implementation, not a score for the final PR.

## Delivery boundary

These are source, simulated-controller, actual-store and rendered-component
checks. A renderer build establishes bundle generation, not a packaged Windows
installer, deployment, cable reliability or physical beam/spindle-off. No real
controller was operated. The PR does not merge, deploy or change provider state.
