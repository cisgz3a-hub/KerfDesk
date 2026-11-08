## ADR-686 Amendment 1 - Only flat, opaque, unmasked white is paper; see-through, gradient and masked white burn, and the notice says what happened (2026-11-08)

**Status:** Accepted. Amends ADR-686 Decisions 1, 2 and 4. Fixes rolling audit v10 V7-P2-1 (P2,
`docs/audits/2026-11-07-rolling-v10/V7-fix-design-burn-safety.md`, confirmed by its refuter, who
weighed P1 on the gradient emblem). Tested through both SVG parsers and the store's import with the
audit's probes; not burn-tested. | **Date:** 2026-11-08

### Context

ADR-686 Decision 1 says a fill "painted pure white" is paper. The knock-out read only the colour
string (`isWhite` in `white-fill-knockout.ts`), and the parser keyed every white with any opacity
above 0 as `#ffffff`:

- `svg-paint.ts` kept the hex of `rgba(255,255,255,0.25)` and `#ffffff80`;
- `parse-svg.ts` drops a fill only at `fill-opacity <= 0`, and applies neither `fill-opacity` nor a
  group's `opacity` otherwise;
- a gradient paints as its first visible stop (`svg-paint-server.ts`, ADR-358 Amendment 2), so a
  radial gradient from a white centre to a blue edge was "white".

The audit measured the result on the store's import and `compileJob`:

| SVG (black square under a 20 × 20 shape) | The file shows | Lit inside the shape |
| --- | --- | --- |
| `fill-opacity="0.3"` white | `#4d4d4d` grey | 7,644 → **0** mm |
| `<g opacity="0.2">` white | `#333` | 7,644 → **0** |
| `rgba(255,255,255,0.25)` | `#404040` | 7,644 → **0** |
| a CSS class with `fill-opacity:.15` | `#262626` | 7,644 → **0** |
| a gradient emblem (white centre, blue edge) beside a black bar | a blue emblem | whole job 5,373 → **2,240** mm |
| white masked to its left half | the right half black | right half 3,354 → **0** |

Every case got the toast "1 white shape will not burn, as in the file: it was cut out of the shapes
under it". "As in the file" was false in all of them, and for the emblem nothing lay under it.

### Decision

1. **Paper is flat, opaque, unmasked white.** The parser marks a white fill it cannot take for paper
   with `whiteInk` on its path (`svg-white-ink.ts`):
   - `'gradient'`: the fill is a gradient (whatever its first stop);
   - `'masked'`: a `mask` applies to the element or any ancestor;
   - `'translucent'`: the fill colour's alpha × `fill-opacity` × the composed `opacity` is below 1,
     or the `fill-opacity` could not be resolved (a `var()`).

   Flat white (`#fff`, `white`, `style`, CSS class, `currentColor`) with full opacity stays unmarked
   and is paper, as before. A stroked element imports as lines and is never marked. The colour still
   keys the operation, so the white keeps its own operation as before ADR-686.
2. **Ink white burns.** A marked white is not paper: it is never cut out, and it is a shape a solid
   white painted after it can cut into (a white diamond over a white-to-blue emblem cuts the emblem).
3. **Decision 2's darker fill.** An import is "more than a white design" when it has a fill of any
   other colour or a gradient. See-through or masked white is still white paint, so a design for
   slate drawn only in white, highlights included, keeps burning every shape.
4. **The notice says what happened.** For solid white: "plate.svg: 2 solid white shapes will not
   burn: the file shows bare material there, so they were cut out of the shapes under them. To burn
   the white too, Undo: it returns on its own operation." The "cut out" clause appears only when a
   white shape actually cut into a darker one (a white background painted first cut nothing). When
   the import also has ink white beside a darker fill, the notice adds: "1 white shape is
   see-through, shaded or masked in the file, so it burns like any colour. To leave it unburned,
   turn its operation's Output off." An import with only ink white gets that sentence alone, as an
   info toast. The colour count drops white only when every white was paper.

### Consequences

- The audit's highlight, emblem and mask cases burn as they did before ADR-686, and the emblem burns
  as its blue-first twin does. The U3 fixtures and every flat white spelling still knock out.
- `ColoredPath.whiteInk` is optional and only on white fills, so older builds, which ignore it, read
  the same project, and no schema change is needed. A project saved by 1.0.29 has no marks, so its
  see-through white counts as paper for Amendment 2's notice; that build imported every white the
  same way, and the notice only offers.
- **Not covered:** a translucent white's real shade (grey over black, near-white over nothing) is not
  derived; it burns at its operation's settings like any colour, as before ADR-686. A pattern fill
  still imports as nothing. Filters are not read.
- **Tests:** `src/io/svg/svg-white-ink.test.ts` (both parsers, every spelling above);
  `src/ui/state/svg-white-fill-knockout-v10.integration.test.ts` ("V7-P2-1"): no knock-out step and
  a burning white for each case, the emblem equal to its blue-first twin, solid white cut out of a
  gradient emblem, the slate design unchanged, and both notice wordings.
