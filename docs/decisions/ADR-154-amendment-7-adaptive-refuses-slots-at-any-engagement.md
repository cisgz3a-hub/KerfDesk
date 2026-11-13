## ADR-154 Amendment 7 - Adaptive clearing refuses a full-width slot at the cutting feed, whatever its Radial engagement (2026-11-13)

**Status:** Accepted (the maintainer's decision, "Refuse slots at 50 %"); software-verified through
emitted G-code carved into an independent height field. | **Date:** 2026-11-13

This takes the decision ADR-154 Amendment 3 left open. Its Consequences recorded that the kept
allowance "would refuse a full slot at engagement limits of 41% of the diameter and more, which the
allowance admits today. That needs its own decision." The Frame-first Start contract (ADR-228,
ADR-565) is unchanged: the verifier still refuses a plan as a compile failure, and the operation
cuts the disclosed offset-ring fallback (Amendment 5) instead.

### Context

The verifier reads engagement from the largest contact arc as r (1 - cos(arc / 2)). A full slot,
180 degrees of contact, reads r: half the diameter, exactly the top of the Radial engagement field
(50 %). With the one-cell allowance, a slot passed at any limit from about 41 % of the diameter
(3.175 mm bit) or 44 % (6.35 mm bit) upward.

CNC audit v3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, KNOWN AC-6) measured
the consequence. At 50 % the verifier certified full-width slots at the cutting feed: 92.5 mm on a
44 × 16 L and 22.4 mm on a 44 × 30 rectangle, by the width each move removes (the auditor's
contact-angle reading gave 72 mm and 21 mm). Both pockets are longer than one entry helix can
open: the innermost ring runs along the middle beyond the helix's disk.

### Decision

1. **A slot is refused at every Radial engagement.** A roughing move whose contact arc reaches
   170 degrees, the N3 auditor's slot line, is a full-width slot. The verifier's ceiling is the
   lower of the configured limit plus its allowance and that slot reading,
   r (1 - cos 85 degrees), 0.913 r (`ADAPTIVE_SLOT_CONTACT_ARC_DEG`,
   `adaptive-pocket-verifier.ts`). A side cut needs a radial depth over 0.99 D to reach that arc.
2. **The refusal says which rule refused.** A move the configured limit refuses keeps the existing
   reason ("radial engagement above the configured limit"). A move only the slot rule refuses gives
   `ADAPTIVE_SLOT_REFUSAL`: "Adaptive verification simulated a full-width slot at the cutting
   feed."
3. **Preview and Job Review read the same notice for both reasons:** "Adaptive can't open this
   pocket from one entry, so it will cut offset rings instead (full-width first pass). Pockets
   longer than they are wide do this." That is what a slot-refused plan is.
4. **The Radial engagement tooltip says so:** "Whatever its value, the clearing rings never cut a
   full-width slot at the cutting feed: a plan that would cuts offset rings instead."
5. **Not changed:**
   - Island partitions' seed rings already cut their unavoidable slot at the plunge feed and are
     disclosed in the field's note (Amendment 4).
   - The finishing and seam cleanup rings stay unmeasured (Amendment 3).
   - The offset-ring fallback still cuts its first ring full width at the cutting feed, as every
     offset pocket does, and the notice says so. Slowing or stepping that first ring would change
     every offset pocket and is not part of this decision.
   - The engagement limit itself and its 50 % cap are unchanged.
6. **Emitter revision** advances to `adaptive-refuses-slots-20261113-v47`.

### Consequences

- A long pocket, an L, or a U whose arms the shared outer rings run round before they are opened,
  set to a Radial engagement wide enough to admit a slot, now cuts offset rings, with the notice.
  At the default 10 % nothing changes: those plans were already refused for engagement.
- `compile-cnc-adaptive-slots.test.ts` emits each refused plan's own program and carves it:
  - the L's plan slots about 97 mm at F1000;
  - the 44 × 30 rectangle's cuts 0.94 D wide;
  - both are refused with the slot reason, and the compile records the fallback;
  - a 32 mm square at 50 % still compiles adaptively, with no full-width window and its widest
    cut under 0.8 D.
- Three 50 % fixtures that relied on the slot being admitted were changed:
  - the U-pocket branch tests keep their two-branch and notch-containment checks and now expect the
    slot refusal;
  - the edge-touching union test uses a 40 × 40 pocket instead of 40 × 20.
- NOT verified: no hardware or air cut.
