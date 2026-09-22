# Controller origin and coordinate evidence audit

Audited base: `288ad66baf23e0c75c0a05f6216787577ddc6812`, isolated checkout
`D:\LaserForge\audit-coordinates-origin-20260921`. Work began 21 September 2026 and
continued after midnight on 22 September (Asia/Shanghai).

The user's machine was subsequently identified as a Falcon A1 Pro 20W. The
confirmed defect below concerns the generic GRBL `$13` settings route. It is not
evidence that this defect occurred on that machine: the A1 vendor driver does
not expose the generic `$$`/`$13` controls. The parent audit owns that exact
machine's four-mode connection/origin/Frame/Start checks.

## Confirmed finding, fixed locally

**ORIGIN-01 / P1: a reporting-unit change could turn a short position-based jog
into a long move in the opposite direction.**

Before the repair, `writeGrblSetting(13, '1')` completed its acknowledged write
and verified settings read but left raw millimetre `MPos` and `WCO` numbers in
the store. Consumers then multiplied those old numbers by 25.4 because the
new settings said the controller reported inches.

Independent fake-transport reproduction:

1. Receive physical machine position `(10, 20)` mm and WCO `(5, 10)` mm.
2. Write `$13=1`, acknowledge it, and return `$13=1` in the verified `$$` dump.
3. Before another status arrives, request `jogToMachinePosition(20, 20, 1000)`.
4. The old code sends `$J=G91 G21 X-234.000 Y-488.000 F1000` instead of the
   required relative move of approximately `X+10, Y0` mm.

The first two new regression tests failed against the audited base. Their
original output is retained in `evidence/origin-unit-switch-repro.txt`.

Repair:

- `src/ui/state/controller-report-units.ts` retains the last reporting-unit
  bit while settings are unqualified and clears raw position, WCO, and Frame
  evidence when that contract changes.
- `grbl-settings-actions.ts:231` marks `$13` writes as having unconfirmed
  report units before the first transport boundary.
- `laser-status-position.ts:38` keeps controller state/accessory reports
  visible while suppressing ambiguous coordinate values.
- `laser-line-handler.ts:249` installs new units and invalidates old raw
  coordinate values atomically at the terminal `$$` boundary. Serial output
  is FIFO: status generated before that verified response is discarded rather
  than reinterpreted. The first later status supplies the new coordinate data.
- `laser-console-actions.ts:177` applies the same treatment to confirmed
  Console writes, including zero-padded `$013`. A failed/ambiguous write stays
  coordinate-unknown until a successful settings read restores the contract.
- Read-only refreshes with unchanged report units preserve spatial evidence.
  A refresh discovering changed units invalidates it. Partial settings dumps
  cannot silently replace a known inch reporting contract with millimetres.
- The remaining sites that clear `controllerSettings` are initialisation,
  disconnect, or a new controller epoch. The common epoch invalidation helper
  now clears WCO with status, preventing an old-unit offset from surviving it.

This repair does not add an ordinary Start policy gate. It corrects factual
coordinate evidence and retains the completed-Frame contract.

## Verified command semantics

The new independent coordinate oracle calculates `WPos = MPos - WCS - G92 -
TLO` without using the application's placement helpers. Its 13 cases cover
positive and negative machine positions, G20/G21, a prior G55 selection,
temporary XY origin, persistent G54, reset, and manual work Z.

- Set origin selects G54 for generic GRBL, declares the current head's work
  X/Y to be zero, and does not move the head.
- Reset origin clears transient G92 on every axis. It restores the underlying
  stored G54 coordinates, which need not coincide with machine zero.
- Set persistent origin first clears G92, then records current XY in G54.
  Clear persistent origin clears stored G54 XY; it does not erase stored G54 Z
  or tool-length compensation.
- Manual Zero Z establishes a separate work-Z reference. Set origin XY alone
  does not establish it. Reset invalidates work-Z evidence because G92.1
  clears its transient Z component too.
- Home establishes the machine reference through the driver's homing command.
  Moving to work zero is a separate relative point move. Stock GRBL `$H` is not
  synonymous with G92.1; the app conservatively invalidates prior reference
  evidence during homing.

The existing fake-transport suites passed acknowledgement ownership, partial
persistent-update rejection, reset/disconnect cancellation, homing settlement,
probe settlement and partial corner-contact failure, no-go/bounds warnings,
MPG interruption, multi-axis reports, and machine-position inference.

## Candidate not promoted to a defect

Set Origin waits for WCO when the cache is empty, but reuses its cached
stationary-position inference when a cache is already present. Its comments
describe that more broadly as a fresh-offset wait. For ordinary GRBL G92 XY,
the command does not move the head and the inferred current machine XY gives
the correct new work offset. No separate incorrect Falcon motion was proven
from this candidate, so it was not changed speculatively.

## Verification evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Existing origin/home/jog/probe/status baseline | 19 files, 179 tests passed | `evidence/origin-existing-tests.txt` |
| New independent coordinate oracle plus selectors, origin UI and fresh-Idle checks | 4 files, 43 tests passed | `evidence/origin-oracle-and-selectors.txt` |
| Original unit-switch reproductions | 2 failed, confirming the defect | `evidence/origin-unit-switch-repro.txt` |
| Post-repair targeted suite | 17 files, 176 tests passed | `evidence/origin-final-tests.json`, `.log`, and `origin-final-files.txt` |
| Final expanded unit-switch regression file, including `$013` | 12 tests passed, supersedes its earlier 11-test entry | `evidence/origin-unit-switch-final.json`, `.log` |

The latest post-repair results therefore represent **17 distinct files and 177
tests**, counting the final 12-test unit-switch file once. The baseline and
oracle rows overlap those files and must not be added mechanically. The parent
audit reruns the affected Frame/Start/Falcon workflow and static checks.

The final five-file ESLint check for the new helper, Console path, connection
defaults, store defaults and regression file passed (`evidence/origin-lint-final.log`).
Prettier and `git diff --check` also passed for this lane's changed files.

No controller was connected or operated. No settings were read from or written
to the user's physical machine. No homing, jogging, laser output, air cut,
probe, or material test occurred; all command traffic above was fake transport.
No commit, PR, merge, or deployment was performed by this audit lane.

## Primary references consulted

- [GRBL coordinate calculations and G92/G10 execution](https://github.com/gnea/grbl/blob/master/grbl/gcode.c)
- [GRBL realtime WPos/MPos/WCO reporting](https://github.com/gnea/grbl/blob/master/grbl/report.c)
- [GRBL system commands and homing](https://github.com/gnea/grbl/blob/master/grbl/system.c)

These establish the generic GRBL software semantics used by the oracle, not
physical qualification of a Creality firmware build.
