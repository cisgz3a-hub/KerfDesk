## ADR-180 Amendment 6 - A router fixes laser mode in place and never writes it on (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

Amendment 5 made the CNC Resume advice follow the controller's `$32`. Job Review now opens its
Warnings list when a router job's controller reports laser mode on or unconfirmed. With `$32=1`,
GRBL and grblHAL skip the spindle spin-up delay: on Resume, on every M3, and on plunges. A stopped
bit is pushed through the cut, and the dwell after M3 runs with the spindle off. Routers often keep
`$32=1` after a laser session. CNC audit JR-1 asked for two more things:

- a guarded one-click "Send `$32=0`" on that row, so the fix sits where the warning is;
- a guard against a router project writing `$32=1` from the Console or Machine Settings, as laser
  projects already have for `$32=0`.

The 2026-09-25 audit of PRs #845-#904 recorded both as JR-1 follow-ups.

### Decision

1. **Send `$32=0` on the warning.** When a GRBL or grblHAL controller reports `$32=1` on a router
   job, Job Review's laser-mode row carries a **Send $32=0** button. After a confirm that names the
   effect, it calls Machine Settings' own `writeGrblSetting(32, '0')`, which applies every write
   rule unchanged:
   - a `$`-setting driver;
   - an Idle controller whose settings were read this session;
   - no operation running;
   - the machine-kind rule below;
   - a `$$` read-back that must show the written value.

   A refused or unverified write is reported in a toast with its reason. A verified one rebuilds Job
   Review from the new settings, so the warning clears. The button is disabled while any controller
   operation runs. It is a fix offer only: the warning never gates Start (PROJECT.md rule 21).
2. **FluidNC gets no button.** Its `$32` follows the spindle type in its YAML configuration and
   cannot be set with `$32=0` (its own warning already says so).
3. **A router project never writes laser mode on.** `grblSettingMachineKindIssue` gains the router
   mirror of the laser rule. On a CNC/router project, Machine Settings and the confirmed Console
   setting lane refuse `$32=1` and every non-zero `$32` before transmission. GRBL truncates `$32`
   to an 8-bit integer, so `0.5`, `1.0` and `256` are refused too. A plain zero (`0`, `0.0`) is
   allowed. The laser rule keeps its exact-`$32=1` form. A hybrid machine switches the project's
   machine kind first, as the laser rule already asks.

### Consequences

- The router's most damaging setting mismatch now has its fix beside the warning that names it,
  and the write cannot bypass any Machine Settings guard.
- A router project can no longer switch laser mode on from the Console by mistake. An operator who
  genuinely needs `$32=1` on that controller is doing laser work, and switches the project to laser
  mode first.

### Evidence

- `JobReviewWarnings.test.tsx`: only the GRBL laser-mode-on row offers the button (not the
  unverified or FluidNC rows). A confirmed click calls `writeGrblSetting(32, '0')` once and reports
  success. A declined confirm writes nothing. A refused write shows its reason.
- `grbl-setting-write.test.ts`: `1`, `1.0`, `0.5`, `2` and `256` are refused for a router through
  both the Machine Settings rule and the Console command form. `0`, `0.0` and `00` are allowed, as
  are other settings. The guarded builder returns the router refusal.
