## ADR-367 Amendment 2 - After any Unlock, a Frame refusal names Home and Set origin here (2026-11-03)

**Status:** Accepted (new-user experience audit U1, area U4, finding U4-P2-5, confirmed by an
independent refuter; the maintainer's standing instruction to fix confirmed audit findings). |
**Date:** 2026-11-03

### Context

ADR-367 Context item 2 described a dead end: Unlock voids the reported position until Home or Set
origin re-establishes it (`controllerUnlockedPatch`), and the Frame that followed was refused with
"Wait for a complete status report", which no report could satisfy. Decision 2 fixed it only for
the Unlock the Frame itself offers, which hands over to Set origin.

The rail's Alarm card **$X — Unlock** and `$X` typed in the Console still led into it. On a homing
profile (Absolute by default) every Frame was refused with "The controller did not report a usable
work position. Wait for a complete status report, then Frame again." while full Idle reports kept
arriving. The same wait wording appears in the Absolute work-offset refusal, the custom-origin
refusal and the post-G54 and post-Zero-Z position waits.

### Decision

1. **While the position is withheld, "wait for a report" refusals are said as their remedy.**
   `reportFrameRefusal` passes every Frame refusal through `withPositionWithheldRemedy`
   (`frame-position-withheld.ts`). When `positionEvidenceSuppressed` is set, each of those wait
   messages becomes one sentence: "Position is unknown after Unlock or Release motors. Home the
   machine, or move the head to where the job should start and use Set origin here. Then Frame
   again." A machine without homing gets the sentence without Home (ADR-341 Amendment 11 item 4).
2. **Every Unlock route reaches it.** The rewrite is keyed on the withheld position, not on which
   button unlocked, so the rail, the Console, the Frame's own offer and Release motors all name the
   way out.
3. **Unconfirmed report units keep their own refusal.** A `$$` read, not Home, restores that
   position (`reportUnitsUnconfirmed`).

### Consequences

- Wording only: no refusal is added or removed, and the gates judge exactly as before (ADR-228).
- Verified against the GRBL simulator for the rail Unlock and the Console `$X`, not on hardware:
  `src/ui/laser/abort-unlock-frame.simulator.test.tsx`.
