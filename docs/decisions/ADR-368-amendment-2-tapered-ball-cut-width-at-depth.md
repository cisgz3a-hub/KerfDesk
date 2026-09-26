## ADR-368 Amendment 2 - A tapered ball nose lays out pockets, profiles and relief roughing by its cut width at depth (2026-09-26)

**Status:** Accepted; software-verified through unit, compile and removal-simulation tests,
hardware qualification pending. | **Date:** 2026-09-26

Amends ADR-368 item 4, whose third bullet kept `diameterMm` as a tapered ball nose's offset
diameter, and narrows Amendment 1. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

ADR-368 stores a tapered ball nose's `diameterMm` as its widest cutting diameter, at the top of
the flutes. Pocket and profile offsets, their stepover, and relief roughing's stepover all used
it. A pass only engages the bit up to the pass depth, where the ball tip and taper cut far
narrower. Amendment 1 warned about this; the 2026-09-25 audit of PRs #845-#904 (CNC-1) asked for
the layout itself to follow the bit.

With Amana 46282 (6.25 mm at the top, 1/16" ball, 5.4 degrees per side), ADR-368's law gives a cut
1.73 mm wide at the stock surface when the tip is 1.5 mm down, 2.01 mm at 3 mm and 2.58 mm at 6
mm. The removal simulator the 3D preview uses showed:

- a 6 mm outside profile standing 1.84 mm outside the line at the stock surface and 2.34 mm out
  where the flank meets the ball (Z-5.28);
- a 3 mm pocket's walls 2.12 mm inside the line at the surface and 2.34 mm inside at Z-2.28,
  with rings 2.5 mm apart (40%) cut by a pass 1.73 mm wide, so ribs 0.77 mm wide stood as tall
  as the pass;
- relief roughing leaving the same 0.77 mm ribs on every 1.5 mm level.

### Decision

1. **Two widths from ADR-368's law.** `core/cnc/layout-cut-widths.ts` derives both from the
   inverse of the height law the kernels stamp (`taperedBallRadiusAtHeightMm`, which the
   catalog's diameter-at-height now reuses):
   - the **wall width**: the cut width at the operation's full depth;
   - the **clearing width**: the cut width over one depth pass, the depth per pass capped at the
     total depth (`zPassStepMm`, the step `zPassDepths` uses).

   Both are capped at `diameterMm` for a cut deeper than the modeled flutes. Every other cutter
   kind keeps `diameterMm` for both, as does a tapered ball nose without a usable tip or taper,
   which ADR-368 item 2 plans as a flat cylinder of that diameter. Their output is unchanged.
2. **Every depth pass of a profile rides one path, offset by half the wall width.** The final
   pass's flank then meets the drawn line at the stock surface, and no pass crosses it: a
   shallower pass on the same path cuts inside the final pass's sweep. A narrower offset would let
   the final pass cut past the line. Offsetting each pass by its own cut radius would give the
   same finished wall, not a stepped one, because every pass's straight flank would lie on the
   same cone. It would need a separate path per depth for tabs, leads and part order, so one path
   was chosen. The finished wall of the 6 mm Amana profile is on the line at the stock surface and
   moves out along the flank by |Z| tan 5.4 degrees: 0.09 mm at 1 mm, 0.28 mm at 3 mm and 0.50 mm at
   Z-5.28. The ball then rounds it into the groove bottom 1.29 mm out at Z-6. An outside part is
   therefore its drawn size at the top face and larger below it; a hole is its drawn size at the
   top face and smaller below it. No offset can give a tapered cutter a vertical wall.
3. **Pockets.** Ring 0, the raster wall pass and the rest-machining finish region use the wall
   width, so a pocket's wall is on the line at the stock surface and moves in along the flank
   (0.22 mm at Z-2.28 in a 3 mm pocket) before the ball rounds into the floor 1.01 mm inside the
   line. Rings and raster sweeps step by the stepover percentage of the clearing width, and the
   check that the pocket's core is reached sweeps that width. Every pass removes at most one depth
   per pass, so neighbouring grooves overlap at the top of every pass up to a 100% stepover and no
   rib stands. At 40% the Amana rings are 0.69 mm apart and leave 0.08 mm scallops.
4. **Relief roughing** steps its rings by the stepover percentage of the clearing width for one
   level. Its dilation already modeled the bit (ADR-368 item 2). Each level removes at most one
   depth per pass, so the ribs go. The scallop between rings stays inside the 0.5 mm finishing
   allowance up to an 85% stepover: 0.08 mm at 40% and 0.49 mm at 85%.
5. **Tabs follow the wall.** A tab window adds the wall width to the tab width, as it added the
   diameter. The bridge is the requested width plus the difference between the cut widths at full
   depth and at the tab top, and it widens down the flank toward its foot. With 6 mm tabs 2 mm
   high on the 6 mm profile, it is 6.76 mm at its top and 8.58 mm at its foot, where the old window
   left 10.43 mm and 12.25 mm. A bridge is never narrower than requested. On-path profiles, whose
   offset never used the diameter, change only here.
6. **Planners, diagnostics and the Design Studio agree.** The offset-ladder, helical-entry and
   dropped-layer diagnostics call the same pocket and profile planners with the same widths. The
   Design Studio's instant carve preview offsets and stamps a profile slot at the wall width, so
   its "real offset" is the compiler's; the Studio's Simulate already stamps the compiled job.
7. **Amendment 1 is narrowed** to a tapered ball nose without a usable tip or taper. Its layout
   still uses the widest diameter, and the 3D preview models that fallback rather than the bit. A
   modeled tapered ball nose no longer warns.
8. **Emitter revision** advances to `tapered-ball-cut-width-20260926-v1`, because tapered
   ball-nose pockets, side-offset profiles, tabbed on-path profiles and relief roughing now emit
   different G-code.

### Consequences

- A cutout or pocket cut with a tapered ball nose now matches its drawn line at the top face, and
  its pocket floor and relief levels are cleared instead of ribbed. The taper and the ball corner
  remain, as the bit dictates; the 3D removal preview shows them.
- Pockets and relief roughing with this bit take many more rings, so jobs run longer; the time
  estimate reads the compiled passes.
- Stepover now means a different length for this bit than for others of the same stored diameter.
  The layer panel says so.
- Not changed: engrave and V-carve do not offset by the diameter. The lead-in arc keeps its
  radius of half the stored diameter; it lies in the waste. The line-art pairing distance and the
  On path size warning still read the stored diameter.
- Not changed, for every cutter: relief roughing ends each ring half a side short of its start,
  and it has no core cleanup, so above a 50% stepover a level's centre can stay uncut. Both are
  separate defects of the ring ladder, not of the cutter width.
- Not changed, and not modeled: a plain ball nose, V-bit or engraving bit in a pocket or
  side-offset profile still lays out by its stored diameter. A plain ball nose cuts its full
  diameter only once a cut is a radius deep, so a shallower wall lands inside the offset (0.86 mm
  per side for a 1 mm cut with the 6.35 mm starter), and a large stepover over shallow passes can
  leave ribs. A conical bit's cut width grows with depth everywhere, so its error is larger. These
  need their own decision.

### Verification

- `layout-cut-widths.test.ts` pins both widths to the law, checks that the removal kernel's
  cutting surface reaches exactly those radii at the stock surface, and keeps every other cutter
  kind, an unmodeled tapered ball nose and an unusable depth on the stored diameter.
- `compile-cnc-tapered-ball-layout.test.ts` compiles Amana 46282 jobs and stamps them with the
  preview's removal simulator. A 6 mm outside profile meets the line at the stock surface, follows
  the flank within two cells at Z-1, Z-3 and Z-5, reaches Z-6 one cut radius out, and cuts nothing
  inside the line. An inside profile's path is one 3 mm cut radius inside. A 3 mm pocket meets the
  line at the surface, cuts nothing outside it or below its floor, and leaves no residual above
  the one-stepover ball rise (0.45 mm with slack) wherever the tip reaches the floor. Relief
  roughing's rings step 0.691 mm and, on the half of the relief away from the ring seams, leave
  no residual above the same bound. Forcing the stored diameter fails all four; with only the ring
  spacing check removed, the relief residual still fails at 3 mm, a rib to the stock top.
- `carve-heightmap.test.ts` shows the Studio slot on the compiler offset at the cut width; the
  stored-diameter slot fails it.
- End mill output is unchanged: existing pocket, profile, tab, rest-machining, relief and G-code
  snapshot tests pass with no snapshot updated.
- No hardware run was made. A physical cut on the 4040 remains the qualification step.
