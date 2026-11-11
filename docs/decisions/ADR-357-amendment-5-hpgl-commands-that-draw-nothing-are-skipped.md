## ADR-357 Amendment 5 - HP-GL commands that draw nothing are skipped, not fatal (2026-11-12)

**Status:** Accepted on 2026-11-12 |
**Amends:** ADR-357 decision 7 ("Unsupported text, clipping, PCL wrappers or drawing styles
reject the whole file with a source diagnostic"), narrowing what counts as unsupported

### Context

Oracle audit O1, area O2 (finding O2-P2-2, `docs/audits/2026-11-11-oracle-o1/O2-file-format-truth.md`)
checked the HP-GL import against HP's PCL 5 Technical Reference, Part II (HP-GL/2). The import
refused a whole file for `VS` (velocity select), `FS` (force select), `PW` (pen width), `NP`
(number of pens), `PC` (pen colour) and similar commands, and for `PG` (advance full page),
with the message "convert unsupported content to outlines". None of these commands draw. The
reference describes them as device or pen attributes, and says a printer ignores `PG` because it
"could cause undesirable results when importing plots". Cutter and plotter drivers write them
routinely: CorelDRAW's PLT export can set a velocity per pen, and Inkscape's HPGL output writes
`VS`/`FS` whenever the user sets a speed or force. So an ordinary `.plt` file was refused, and
the advice pointed at content that was already outlines.

ADR-357 named text, clipping, PCL wrappers and drawing styles. PROJECT.md narrows the rule to
"unsupported HPGL drawing commands". The refusals of `VS`, `PW` and `PG` came from a later audit's
reading and a test that pinned it, not from either document.

### Decision

1. **`VS`, `FS`, `NP`, `PW`, `WU`, `PC`, `CR`, `MC`, `TR` and `LA` are skipped with one warning
   note** ("... only set plotter speed, force, pen width or colour; they draw nothing"). The
   imported geometry is identical to the same file without them. A laser cuts the centre line,
   so pen width and line ends have no geometric meaning here.
2. **One `PG` that ends the job is accepted.** A file that draws after a `PG` is refused with
   `multiple-pages` ("save each page as its own file"), because ignoring the page break would
   stack two pages on top of each other.
3. **Commands that change geometry or clipping stay refused:** `RO` and `IR` (coordinate
   system), `IW` (clip window), `PS` (moves the default P1/P2 that scaling may use), `CT`
   (switches the chord tolerance to a distance), and every drawing or style command that was
   refused before (`LB`, `PE`, `BZ`, `SM`, `DT`, patterned `LT`, hatch `FT`).

### Consequences

- An HP-GL file that sets cutting speed or force, pen width or pen colours now imports.
- The note tells the user those settings were not carried over. KerfDesk takes speed and power
  from the layer, not from the file.
- Regression fixtures in `src/io/hpgl/parse-hpgl.test.ts` (block "HPGL commands that draw
  nothing (O2-P2-2)") compare each attribute file's geometry with the same file without it.
