## ADR-632 - A gentler hover pulse (2026-10-19)

**Status:** Accepted; decision 3 (the halo) amended by ADR-632 Amendment 1. Amends ADR-620 decision 2 (the pulse's timing, strength, glow and edge). | **Date:** 2026-10-19

### Context

ADR-620's hover pulse snaps to full colour in about 220 ms and holds it. Its brightest glow
appears in the very first frame, and while the pointer rests it leaves an 85% colour edge.
The maintainer briefly tried lighting only the hovered piece in its own colour, then went back
to ADR-620's grouping: every piece with the same settings lights up in the hovered piece's
colour. They asked for the highlight itself to be a little more gentle and beautiful.

### Decision

What lights up, and in which colour, stays as ADR-620 decides. Only the look changes:

1. **A breath, not a flash.** The colour swells with an eased sine to its peak a third of the way
   through the pulse and ebbs back to ink with the same easing. There is no flat hold, and the
   pulse lasts 1900 ms instead of 1400 ms.
2. **A tint, not a repaint.** The peak is 78% colour (`PULSE_PEAK_STRENGTH`), so the ink line
   still shows through. Reduced motion shows that same tint while the pointer rests.
3. **A faint halo.** The glow breathes with the colour and peaks at 34% (it used to start at
   60%). It drifts outward from a 6 px to a 22 px blur instead of blooming to 26 px.
4. **A softer resting edge.** While the pointer stays, the edge is 50% with an 8 px blur
   (previously 85% and 5 px), and it fades in and out with a 180 ms time constant (previously
   90 ms).
5. **A calmer ripple.** Pieces start up to 560 ms apart (previously 420 ms), at 110 ms plus
   0.8 ms per screen pixel from the hovered piece. A row sweep steps 90 ms per piece.

### Alternatives

- **Light only the hovered piece, in its own colour.** Tried on this branch and reverted at the
  maintainer's request: they prefer seeing which artwork shares the settings.

### Consequences

- The highlight takes about half a second longer to finish and never fully recolours the artwork.
- Display only: G-code, Preview, Frame, Start, saved projects and export are unchanged.

### Verification

`src/ui/workspace/artwork-pulse.test.ts` checks the eased start, the peak below full colour with no
flat hold, the halo peaking with the colour and drifting outward, the sweep cap, and the reduced
motion tint. The look was checked in the browser build.
