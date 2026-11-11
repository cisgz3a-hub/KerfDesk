# Code quality audit C2 — areas

**Requested by** the maintainer on 2026-11-11: "I need new loops to test code quality".

**What changed since C1.** [C1](../2026-11-10-code-quality-c1/LEDGER.md) was a one-time census of the code at `f61a0757a`. Since then, 64 pull requests have merged, touching 1,144 files with 45,607 lines added. They include:
- WebUSB lasers (ADR-702), Moshiboard (ADR-705), Ruida over UDP (ADR-697);
- EPS/AI import (ADR-700), 3D Sliced and Fill Ramp (ADR-699), the guided first job (ADR-698);
- the camera picture worker, the rotary A/Z axis, taper and surface feed.

Rolling audit v14 found that most new defects have one shape: **a new route skips a rule that lives somewhere else, and the tests are too weak to notice.**
- A ramped Fill missed the rotary scan rule (Z3-P1-1).
- The Moshiboard missed the rotary feed match (Z3-P1-2).
- The turn-back's wait was copied from a status-burst helper and passed only because the simulator finishes every jog in 400 ms (Z2-P2-1).
- The overlay fix's guard passed at a window size where the bug was small (Z1-P1-1).

C2 therefore looks for that shape across the code, and measures how strong the tests are, not only how many there are.

## Loop

Each area runs once, one agent at a time:
1. an auditor;
2. a fresh refuter with its own method;
3. the coordinator re-checks every P1 and P2 in main's code;
4. a ledger entry in a docs pull request;
5. every confirmed P1 and P2 gets a fix pull request, through the session that wrote the code where one exists. P3s go to a sweep.

Finding IDs are `D<area>-P<n>-<k>`.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Harms a job, loses work or exposes a secret (METHOD §3), or lets such a defect reach `main` unchecked. |
| P2 | A real defect with limited harm, or a gap in the checks that already holds a real failure. |
| P3 | A structural or tidiness weakness with no defect found behind it. |

## Areas (run order)

| # | Area id | Question | Method |
|---|---|---|---|
| D1 | `merge-train-review` | Is the code merged since C1 correct? | A line-by-line review of the high-risk merges since `f61a0757a`: USB link, Moshi, Ruida UDP, EPS/AI import, Fill Ramp and 3D Sliced, camera worker, rotary axis/feed/taper, Abort auto-restore. Each suspected defect is reproduced, not just read. |
| D2 | `single-choke-points` | Does every rule that must hold on every output route live in one place every route passes through? | List the rules: rotary scan and feed, power range, bed bounds, laser off at stop, the frame permit, units and offsets. Trace each one through every route: GRBL, Marlin, grblHAL, FluidNC, Ruida `.rd` and UDP, Moshi, the WebUSB routes, CNC, export files. Then emit the same job through each route and compare. |
| D3 | `test-strength` | Would the tests catch a real bug in the code that controls the beam and the motion? | Hand mutation testing on a copy: change one operator, constant or condition at a time in the emitters, the stop/Abort/resume path, the rotary transform, power scaling and the Job Review safety warnings. Run each module's own tests and report every surviving mutant that would change a burn or a stop. Also look for simulators and fakes whose timing hides real behaviour. |
| D4 | `error-paths-and-async` | Do failures surface, and do async steps stay in order? | Swallowed errors (`catch(() => undefined)`, empty catches), unawaited promises, fixed timeouts that should follow the work, races between stores, worker crash and never-answers paths, and cancellation. Each one is driven to its failure, not just read. |
| D5 | `input-boundaries` | Is every untrusted input checked before it is used? | Project and machine files, controller replies, USB bytes, camera, phone and MCP messages, imported artwork. Structured fuzzing with generated inputs against the real parsers. A trust boundary: security findings stay redacted until fixed. |
| D6 | `structure-and-drift` | Have C1's gains held, and do the documents match the code? | C1's guards (shared helpers, dead exports, file-size caps), complexity hotspots, ADRs whose stated behaviour the code no longer has, and comments that say the wrong thing. |
| D7 | `ci-health` | Does CI catch failures quickly and reliably? | Flaky and timing-based specs, jobs with no time limit (a #1730 smoke job hung for over 86 minutes), duration, which checks are required, and pull requests merged onto a red `main` since C1. |

## Rules

- **Trees:** a fresh `git archive` export of `origin/main` per area, with a `node_modules` junction. Never delete a tree recursively, and never edit its sources. Mutations happen only in the agent's own copy.
- **Agents:** report only: no commits, no branch switches, and never `git stash`.
- **Safety:**
  - simulated controllers and stub cameras only; never hardware or a real serial or USB device;
  - never live external services;
  - never `pnpm`, never building or packaging the desktop app, never launching the installed KerfDesk.
- **Memory gates:** Vitest needs at least 1.5 GB free and an explicit file list. A browser run needs at least 2 GB free: headless, one worker, one spec.
- **Changes:** anything that could move a toolpath or change what users see is listed for the maintainer, not changed, unless it is a confirmed P1 or P2.
- **Fix pull requests:** auto-merge with the MERGE method, plus Auto-fix.

**Status:** started 2026-11-11. D1 ledgered ([LEDGER.md](LEDGER.md)). It runs alongside the last area of rolling audit v14 (Z4, the round-glass journey), one agent at a time.
