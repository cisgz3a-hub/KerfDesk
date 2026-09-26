## ADR-368 Amendment 3 - Ball-nose, V-bit and engraving bits lay out pockets, profiles and relief roughing by their cut width at depth (2026-09-26)

**Status:** Accepted; software-verified through unit, compile, removal-simulation and emitted
G-code differential tests, hardware qualification pending. | **Date:** 2026-09-26

Extends Amendment 2 from the tapered ball nose to every cutter that narrows toward its tip, and
widens Amendment 1's warning to the cutters that still cannot be modeled. Amends Amendment 2 item 1
("Every other cutter kind keeps `diameterMm`") and resolves its "Not changed, and not modeled"
consequence. The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged:
nothing here adds a guard or turns a warning into a block.

### Context

Amendment 2 sized tapered ball-nose pockets, profiles and relief roughing by the width the bit cuts
at depth. Every other cutter still used its stored diameter, and three of them narrow toward the
tip, so they carried the same class of error with no warning:

- **Plain ball nose.** It cuts its full diameter only once the cut is as deep as its radius. With
  the 6.35 mm starter, a 1 mm cut is 4.626 mm wide, so a 1 mm-deep outside profile stood 0.862 mm
  off the line at the top face and the part came out 1.72 mm oversize. Over shallow passes a large
  stepover left ribs: at 90% and 1 mm per pass the rings were 5.715 mm apart and each pass cut
  4.626 mm wide, so a ridge 1.79 mm tall stood between rings, 0.79 mm above each pass. At 85% and
  1.5 mm per pass the ridge just reaches the top of the pass.
- **V-bit and engraving bit** in a pocket or a side-offset profile. A cone's cut width grows with
  depth everywhere, so the error is larger. A 60 degree 6.35 mm V-bit on a 3 mm profile cuts 3.464
  mm wide and stood 1.443 mm off the line per side. In a 3 mm pocket at 40% and 1.5 mm per pass its
  rings were 2.54 mm apart, each pass cut 1.732 mm wide, and ridges 2.2 mm tall stood between them.
  A 30 degree engraver with a 0.2 mm flat on a 3.175 mm cut sat its 1 mm-deep inside profile
  1.22 mm too far in.
- **Minor, on the stored diameter:** the On path size warning's amount, the full-tab-coverage
  warning's wording ("tab width + bit diameter"), the line-art pairing distance and the lead-in
  arc's default radius.

V-carve and engrave were never affected: they do not offset by the diameter.

### Decision

1. **Correct geometry for every narrowing cutter whose envelope is defined.**
   `core/cnc/layout-cut-widths.ts` inverts the cutting surface each removal kernel stamps
   (`sim/tool-kernels.ts`) to get the width a pass cuts at its top, `h` below the stock surface:
   - ball nose: its sphere, `2·√(h·(D − h))`, until `h` reaches the radius;
   - V-bit and engraving bit: the cone and its tip flat, `2·r0 + 2·h·tan(angle / 2)`, through the
     shared `radial-envelope.ts` law;
   - tapered ball nose: ADR-368's ball and flank, as in Amendment 2.

   Each is capped at `diameterMm`. The wall width (full depth) and the clearing width (one depth
   pass) keep Amendment 2's meaning and consumers: profile offsets, pocket ring 0 and the raster
   wall pass, the rest-machining finish region, pocket ring and raster spacing, relief-roughing ring
   spacing, tab windows, the offset-ladder, helical-entry and dropped-layer diagnostics, and the
   Design Studio's profile slot. A flat end mill keeps `diameterMm` for both. So does a narrowing
   bit for any width taken at least as deep as it narrows: a ball nose's wall width once the cut
   is a radius deep, and its clearing width once each pass is.
2. **A warning, not a guess, where the envelope is undefined.** A V-bit or engraving bit without a
   valid stored included angle, an engraving bit with an explicit but invalid tip flat, and a
   tapered ball nose without a usable tip or taper keep `diameterMm`. The kernels and V-carve fall
   back to a 60 degree cone for a missing angle, but a layout that guessed would put the wall past
   the line with any wider bit. The stored diameter is the widest the bit cuts, so its error always
   lies in the waste. Amendment 1's Job Review warning now covers all of these
   (`cnc-unmodeled-bit-layout-warnings.ts`, renamed from `cnc-tapered-ball-layout-warnings.ts`,
   through `cncLayoutFallsBackToStoredDiameter`). It names what the bit lacks and asks for it or a
   flat end mill. It never blocks save or Start.
3. **Walls.** As in Amendment 2 item 2, every depth pass rides one path offset by half the wall
   width. The wall meets the drawn line at the stock surface and follows the bit below it: the ball
   curves into the groove, the cone slopes at half its angle. An outside part is its drawn size at
   the top face and larger below; a hole is its drawn size at the top face and smaller below. No
   offset can give these bits a vertical wall above the depth where they reach full width.
4. **Stepover.** Rings and raster sweeps step by the stepover percentage of the clearing width, so
   neighbouring grooves overlap inside every pass up to 100% and no rib stands above a pass. A ball
   nose then leaves only its scallop, and a pointed cone leaves ridges one stepover fraction of a
   pass tall between rings. That is the shape of a cone, not a rib. A pointed bit over very shallow
   passes can need many rings. The existing 4096-ring backstop and its pass-limit advisory
   (ADR-206) still apply.
5. **Job Review wording follows the cut width.** The On path size warning gives the width the bit
   cuts at the top face when that is less than its diameter. The full-tab-coverage warning names
   the cut width a window adds. End-mill wording is unchanged.
6. **Kept on the stored diameter, deliberately.**
   - The lead-in arc's default radius stays half the stored diameter. The whole lead lies on the
     waste side of the offset toolpath, whose distance from the part is at least the cutter's radius
     at any depth of the pass, so it never reaches the finished wall. A shorter arc would only fit
     tighter nests, and it would change ADR-250's default for these bits.
   - The line-art pairing distance stays the stored diameter. ADR-218 uses it to decide that two
     traced outlines are one drawn stroke, and the user picks which edge to cut. A narrower
     threshold would turn traced strokes back into double outlines for V-bit engraving, a role this
     amendment does not change.
7. **Emitter revision** advances to `narrowing-bit-cut-width-20260927-v1`, because ball-nose,
   V-bit and engraving pockets, side-offset profiles, tabbed on-path profiles and relief roughing
   now emit different G-code.

### Consequences

- Profiles and pockets cut with these bits match the drawn line at the top face, and pocket floors
  and relief levels are cleared instead of ribbed. The 3D removal preview shows the ball or cone
  wall and floor.
- Pockets and relief roughing with these bits take more rings when a pass is shallower than the
  bit narrows. The 6.35 mm ball nose over 1.5 mm passes steps 85% as far as before. The 60 degree
  V-bit over 1.5 mm passes steps 27% as far, so a V-bit pocket's program grows several times. The
  time estimate reads the compiled passes.
- Stepover means a percentage of a different length for these bits than for an end mill of the
  same diameter. The layer panel says so.
- Reopening a saved project gives new output for these roles. G-code saved earlier is unchanged,
  and its header names the older emitter revision.
- Not changed: adaptive clearing (end mill only), a rest-machining roughing bit (end mill only),
  V-carve, inlays, engrave, drill, on-path profiles without tabs, and relief finishing, which
  already reads the bit's true shape. Relief roughing's seam and core defects noted in Amendment 2
  remain.

### Verification

- `layout-cut-widths.test.ts` pins each law, checks that the removal kernel's cutting surface is
  exactly the depth and the pass depth at half the two widths for a ball nose, a V-bit, a flat-tip
  engraver and a tapered ball nose, and keeps an end mill, any cut past the flutes, an unusable
  depth and every unmodeled cutter on the stored diameter.
- `compile-cnc-nonflat-layout.test.ts` compiles real jobs and stamps them with the preview's removal
  simulator:
  - a 1 mm outside profile with the 6.35 mm ball nose meets the line at the stock surface, follows
    the sphere at Z-0.25 and Z-0.5, and cuts nothing inside the line;
  - a 4 mm inside profile with it still offsets by its radius;
  - a 2 mm pocket at 90% and 1 mm per pass leaves no more than the ball's rise half a spacing out
    between rings (0.78 mm), and nowhere more than one pass;
  - relief roughing over 1.5 mm levels steps its rings 2.158 mm;
  - a 3 mm outside profile with the 60 degree V-bit meets the line and follows the 30 degree flank
    at Z-1 and Z-2;
  - a 3 mm V-bit pocket meets the line, cuts nothing outside it or below its floor, and leaves no
    more than the cone's rise one spacing out (1.2 mm, under the 1.5 mm pass);
  - a tabbed on-path V-bit part on 3 mm stock keeps a 6.31 mm bridge top for 4 mm tabs, where the
    stored diameter left 9.2 mm;
  - the flat-tip engraver's 1 mm inside profile sits 0.368 mm in.
- Red check: against Amendment 2's code every one of these tests fails except the radius-deep
  profile, which pins the unchanged case. At Z-0.05 the ball-nose wall stands 0.89 mm and the
  V-bit wall 1.45 mm beyond where the bit's shape puts it, and the engraver's path sits 1.22 mm
  too far in. With the wall checks set aside, the ball-nose pocket measures 1.76 mm between rings,
  the V-bit pocket leaves its centre uncut to the full 3 mm, and the tab bridge top measures
  9.21 mm. The new width, warning and wording tests fail too.
- A differential emission over 360 programs (12 cutters by 10 roles by 3 depths): every end-mill,
  tapered ball-nose (modeled or not) and angle-less V-bit program is byte-identical to Amendment 2.
  Ball-nose, V-bit and engraving programs change only in pockets, side-offset profiles, tabbed
  on-path profiles and relief roughing, and only where a pass is shallower than the bit narrows.
- Warning, On path, full-tab-coverage and Design Studio tests cover the wording and the slot. The
  existing pocket, profile, tab, rest-machining, relief and G-code snapshot tests pass unchanged.
- No hardware run was made. A physical cut on the 4040 remains the qualification step.
