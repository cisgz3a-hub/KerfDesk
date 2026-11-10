## ADR-700 - EPS, PostScript and Illustrator 3–8 import

**Status:** Accepted (maintainer request, 2026-11-10: "Plan and build all", after a competitor
scorecard named EPS and older non-PDF AI files as the only common artwork formats KerfDesk could not
open). Amends the ADR-357 scope recorded in PROJECT.md ("Legacy non-PDF AI ... remain explicit
errors"). Burn, G-code, Frame and Start are unchanged. | **Date:** 2026-11-10

### Context

Clip-art libraries, sign shops and older design programs still hand out `.eps` files, and
Illustrator 8 and earlier saved `.ai` files as PostScript rather than PDF. KerfDesk refused both.
LightBurn, VCarve and Inkscape read them. The only open-source renderer that reads PostScript in
general, Ghostscript, is AGPL, which `pnpm license-check` rejects (ADR-017) and a closed paid app
cannot ship.

### Decision 1 - A clean-room PostScript subset interpreter

`src/io/postscript/` interprets PostScript from the Adobe PostScript Language Reference (3rd ed.)
and the Adobe DSC 3.0 and EPSF 3.0 specifications. It is written from those documents only:

- A scanner for numbers (including radix), strings (escapes, hex, ASCII85 kept raw), names,
  `//` immediate names and procedures.
- An operand stack, a dictionary stack (systemdict, globaldict, userdict) and procedure execution,
  with the stack, arithmetic, relational, control (`if`, `for`, `repeat`, `loop`, `forall`, `exit`,
  `stop`/`stopped`), dictionary, array and string operators a prolog uses.
- The graphics state (`gsave`/`grestore`, `save`/`restore`, CTM operators with their matrix-operand
  forms), path construction (`moveto` … `curveto`, relative forms, `arc`/`arcn` as ≤ 90° Béziers,
  `arct`/`arcto`, `rectfill`/`rectstroke`), painting (`fill`, `eofill`, `stroke`) and colour (gray,
  RGB, CMYK, HSB, `setcolorspace`/`setcolor` including Separation spaces through the file's own tint
  transform).
- Environment queries (`languagelevel`, `where`, `known`, `findresource`, `setpagedevice` …) answer
  as a plain LanguageLevel 2 device, so prologs that probe for features take their simplest branch.

Paths are stored in default user space (points), with the CTM applied when each point is added, as
the language defines.

### Decision 2 - Illustrator files use Illustrator's documented operators

Files written by Adobe Illustrator (a `%%Creator: Adobe Illustrator` header or `%AIn_` comments)
are read differently. Their prolog names procsets that `.ai` files often do not carry, and the
procsets use far more of the language than the artwork needs. KerfDesk skips the prolog and setup
and runs the script with the operators defined in the Adobe Illustrator File Format Specification
(1998): `m l L c C v V y Y h H`, the paint operators `N n F f S s B b`, compound paths `*u`/`*U`,
the fill rule `XR`, colour `g G k K x X Xa XA Xx XX` and line width `w`. Other script operators
(layers, locking, guides, text and raster bodies) clear their operands and draw nothing. A custom
colour's tint follows the specification's meaning, 0 being the full colour.

### Decision 3 - Output goes through the SVG import

The painted paths become an SVG document: one point is one user unit, the size is the
`%%HiResBoundingBox` (else `%%BoundingBox`) in millimetres, Y is flipped, fills, strokes, fill rules
and colours are kept. That SVG is imported exactly as an SVG file (sanitising, physical size,
operations by colour, white-fill handling, range checks), as PDF vector pages already are. The
artwork keeps the original file name as its source. If paths reach past the declared box, the page
grows to hold them and the import says so.

### Decision 4 - What is skipped, what is refused

Skipped with a warning toast: text (each `show` or Illustrator text object; convert text to outlines),
clipping (the full shapes import), dashes (solid lines), gradients and patterns (solid colour),
Illustrator placed or embedded images, and pages after the first. Embedded Type 1 fonts (`eexec`)
are skipped silently.

Refused with a reason, importing nothing: PostScript images (`image`, `colorimage`, `imagemask`) and
any other read from the file itself (`readstring`, `filter` …), `strokepath`, Pattern and other
unsupported colour spaces, operators the reader does not know, and files that are not PostScript.
A refused file never imports partial artwork that could be wrong.

### Decision 5 - Bounded work

Every executed object costs a step (20 million), path points are capped at 2 million, procedure
calls at 256 deep, the operand stack at 100,000 and arrays and strings at 100,000 elements. A file
that loops or grows past these ends in an error, never a hang. `stopped` cannot catch the budget.

### Decision 6 - Routing

`.eps`, `.epsf`, `.epsi` and `.ps` are PostScript. An `.ai` file is sniffed: a DOS EPS header or
`%!` without `%PDF-` in its first kilobyte goes to this reader; PDF-based `.ai` files keep going to
the PDF importer (ADR-357). The unified Import picker lists `.eps`, `.epsf` and `.ps`.

### Consequences

- Editable paths from EPS clip art and Illustrator 3–8 files, with no new dependency.
- Conversion runs on the UI thread before the SVG parse (which uses the import worker). Typical
  EPS files take milliseconds; the step budget bounds the worst case.
- EPS files saved by Illustrator 9 or later draw with Illustrator's own procsets rather than the
  AI 3–8 operators. They usually import nothing, and the error says to save them as SVG or PDF.
- CMYK converts without a colour profile, so colours can differ slightly from the source program.
  Operations are keyed by colour, so this matters only for colour matching, not geometry.
- Evidence: unit tests round-trip KerfDesk's own EPS writer goldens, a cairo/Inkscape-style prolog,
  hand-written Illustrator 3 and 8 files from the specification, DOS EPS headers, refusals and the
  budget, and the dispatch tests cover routing. No third-party sample files are checked in, so
  coverage of real-world EPS from other programs (CorelDRAW, older Freehand) is not yet proven.
