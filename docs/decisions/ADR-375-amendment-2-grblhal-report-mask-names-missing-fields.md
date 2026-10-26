## ADR-375 Amendment 2 - grblHAL's `$10` names the report fields it turns off (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

Controller audit v2 finding C8-P2-2 (`docs/audits/2026-10-22-controller-v2/C8-ctl-machine-ui.md`,
confirmed by a refuter and the coordinator). ADR-375 decision 2 treats a missing `WCO:` as "not
reported yet": GRBL sends it in only some reports, so KerfDesk waits a little and then assumes
zero. That is true of stock GRBL, whose `$10` picks only MPos or WPos (bit 0) and the buffer field
(bit 1), and whose reports carry `WCO:` and `Ov:` whatever `$10` holds.

grblHAL is different. Its `$10` is a 16-bit mask
([settings.h L655-L675](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.h#L655-L675)):

- bit 0 picks MPos over WPos;
- bit 5 sends `WCO:`;
- bit 6 sends `Ov:`.

At `COMPATIBILITY_LEVEL` 0 (its default) or 1, grblHAL stores and prints the whole value
([settings.c L862-L872](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L862-L872),
[L1739-L1745](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L1739-L1745),
[config.h L97](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/config.h#L97)).
Its default is 511. Its report writes `|WCO:` only with bit 5 and `|Ov:` only with bit 6, and
with bit 0 clear it writes `|WPos:`
([report.c L1331-L1340](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1331-L1340),
[L1471-L1507](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L1471-L1507)).

A stock-GRBL value therefore turns both fields off for good:

- `$10=0`: LightBurn's "Setting Up CNC-Based Lasers" page tells GRBL owners to type it.
- `$10=1`: a value copied from stock GRBL.

`$10=0` also leaves WPos without the offset that gives the machine position.

KerfDesk parsed `$10` but did not use it, so on grblHAL:

- the status panel read "Origin: not reported yet" for good;
- Move to position, Use current and saved positions said to wait for a status report;
- every Frame spent its 3 s burst waiting for a `WCO:` that cannot come;
- a homed Absolute Frame was refused with "wait for a fresh Idle status report";
- Set origin here waited 3 s and then said to jog;
- every CNC Job Review asked to wait for an `Ov:` report.

### Decision

1. **Read `$10` whole only when the `$$` shows it whole.** Above level 1, grblHAL prints only bits
   0 and 1 of `$10` and keeps the others from its build. Its `$$` then lists only the stock GRBL
   settings
   ([system.c L300-L318](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/system.c#L300-L318),
   [report.c L503-L507](https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L503-L507)).
   The `$$` snapshot marks `$10` as shown whole (`statusReportMaskIsFull`) in either of two cases:
   - it is above 3;
   - the same dump lists any setting outside $0-$7, $10-$13, $20-$27, $30-$32 and $100-$139.

   Such a setting can only come from level 0 or 1, for example `$384`. A dump with neither claims
   nothing, and KerfDesk keeps waiting as before.
2. **Only grblHAL's `$10` has those bits.** The grblHAL driver declares the capability
   `statusReportMask: 'grblhal-fields'`. Stock GRBL and FluidNC keep their behaviour, so nothing
   changes when their `$10` is 0 or 1.
3. **Say what is off, name the bit and the `$10` to send.** When the mask has bit 5 or bit 6
   clear, the suggested value is `$10` with bits 5 and 6 set and every other bit kept:
   `$10=0` becomes 96, `$10=1` becomes 97. KerfDesk never writes `$10` itself; the Console write
   reads the settings back, so the text clears once the value changes.

   The places that say it:
   - the status panel's `Origin:` row, with a tooltip;
   - an `MPos:` row that says the position cannot be known;
   - the override box;
   - the Move to position, Use current and saved-position toasts;
   - jog to point;
   - Job Review's work-offset warning and CNC override line;
   - the Absolute, User Origin and Current Position placement refusals;
   - the Set origin here log line.
4. **Never guess a machine position.** With bit 0 and bit 5 clear, nothing converts WPos to MPos.
   The status panel says "cannot be known (WPos only, no WCO)", and moves that need MPos say why.
   Absolute and Current Position keep ADR-375's assumed zero offset, as Job Review states. The
   physical Frame traces where the job runs.
5. **Frame and Start warn; they do not wait or refuse anew.** With WCO off, Frame skips the 3 s
   burst. A homed Absolute Frame goes on at the assumed zero instead of being refused. That
   refusal waited for a report this firmware will not send, which made it a policy judgment, not
   a transport fact (PROJECT.md non-negotiable 21, ADR-228). Placements that cannot resolve
   without the offset keep their existing refusals, now with the `$10` text:
   - Absolute over a set origin;
   - User Origin;
   - Current Position without a usable report.

   The CNC override line stays the Job Review warning it already is.

### Consequences

- An operator who follows LightBurn's GRBL advice on a grblHAL board sees the missing field and
  the exact `$10` to send instead of a wait that never ends.
- Still open:
  - grblHAL above level 1 with a `$10` that hides upper bits cannot be read from `$$`, and
    KerfDesk waits as before. Its upper bits come from the build, and they are on by default.
  - An older grblHAL whose level-0 `$$` lists no non-stock setting while `$10` is 3 or below
    behaves the same way.
  - A grblHAL board on the stock GRBL driver (the "Grbl 1.1f" banner of level 1) is not detected
    as grblHAL.
  - FluidNC's `$10` semantics were not checked.
  - `stream-throughput-warnings.ts` still names the buffer-state bit without reading `$10`.

### Evidence

Code and simulated-controller evidence only. No grblHAL board with `$10=0` was available.

- `status-report-mask.test.ts`:
  - `$10=0` gives WCO, Ov and the machine position off, suggesting 96;
  - `$10=1` gives WCO and Ov off, suggesting 97;
  - 511 gives nothing;
  - single bits keep the other bits;
  - nothing is claimed for stock GRBL, FluidNC or a `$10` not shown whole.
- `parse-settings.test.ts`: a `$10` above 3, or beside `$384`, is marked whole. A legacy-only dump
  is not.
- `grblhal-status-report-mask.test.tsx` runs a grblHAL `$$` and 40 status reports through the line
  handler, the store and the status panel:
  - `$10=0`: "MPos: cannot be known", "Origin: not reported (WCO off in $10; send $10=96)", the
    Move-to, CNC override and Job Review texts.
  - `$10=1`: the MPos row stays and the origin names `$10=97`.
  - 511: the offset and overrides are shown and `$10` is not mentioned.
  - Stock GRBL with `$10=1` still asks for WCO.
  - Frame sends no status burst when `$10` turns WCO off, homed or not.
  - An Absolute Frame over a set origin names `$10=97`.
