## ADR-632 - The hover pulse lights only the hovered artwork, in its own colour (2026-10-19)

**Status:** Accepted. Amends ADR-620 decisions 2 to 4. | **Date:** 2026-10-19

### Context

ADR-620 pulsed the hovered piece and every piece whose operation had the same settings, all in
the hovered piece's colour. Every new artwork gets its own operation, and most start with the
same default settings, so in practice resting on one piece lit up all of the artwork in one
colour. The maintainer tried it and asked for two changes: each artwork should show its own
colour, and only the artwork under the pointer should light up.

### Decision

1. **Only the hovered piece pulses.** Resting the pointer (90 ms) on artwork with the Select tool
   pulses that piece alone. Other artwork stays in ink, whether its settings match or it shares
   an operation with the hovered piece.
2. **Its own colours.** Each path pulses in the colour of its own operation. A piece bound to two
   operations shows each operation's paths in that operation's colour.
3. **Operation rows.** Resting on an operation row pulses the artwork that operation draws, in
   the row's colour, sweeping left to right. Other operations with the same settings stay in
   ink.
4. **No settings matching.** The pulse no longer compares operation settings, so ADR-620
   decision 3 and the laser/CNC settings comparison behind it are removed. Switching between
   laser and CNC no longer changes what pulses.

Everything else in ADR-620 stands: ink at rest, one pulse per hover with a soft edge while the
pointer stays, the click/drag pause, locked artwork, the Alt peek, reduced motion, the blue first
operation and the separate overlay canvas.

### Alternatives

- **Keep the same-settings group, each piece in its own colour.** Offered; the maintainer chose
  the hovered piece alone.

### Consequences

- The canvas no longer shows which pieces share settings on hover. The Artwork panel rows and
  the Alt peek still show every operation's colour.
- Display only: G-code, Preview, Frame, Start, saved projects and export are unchanged.

### Verification

`src/ui/workspace/artwork-pulse.test.ts` covers the hovered-only target, a piece with two
operations and the row sweep. `draw-artwork-pulse.test.ts` checks that each piece paints in its
own operation colour. `ArtworkPulseOverlay.test.tsx` checks that a same-settings neighbour stays
in ink and that a row hover retargets after an edit without a second pulse.
