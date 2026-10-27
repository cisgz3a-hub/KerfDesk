## ADR-046 Amendment 1 - An SVG root sized in Q imports at that size, and one the importer cannot size says so (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-046's decision that a root width or height in `%` "and other unparseable lengths
count as undeclared" (`DECISIONS.md`), under PROJECT.md non-negotiable 6 (explicit unit
conversion at the import boundary)

### Context

Rolling audit v5, report J6 (adversarial parsers), confirmed J6-P3-2, and its refuter raised it to
P1: an SVG whose root is sized in `Q` imported at the wrong size with no note.

- CSS Values and Units 3 (W3C CRD 2024-03-22) section 5.2 lists `Q` among the absolute lengths:
  "1Q = 1/40th of 1cm", a quarter of a millimetre. SVG 2 sizes the `svg` element with CSS lengths.
  Chromium 152 draws `<svg width="200Q" height="200Q" viewBox="0 0 100 100">` at 50 mm, the same
  as `50mm` and `5cm`, and reads `200q` the same.
- `io/svg/svg-units.ts` kept two unit tables. The one for element lengths had `q`; the one for the
  root size did not, so the root counted as undeclared: that file imported at the viewBox size,
  100 mm, and without a viewBox at the 100 px fallback, 26.46 mm, with `notes: []` either way.
- Any other root unit KerfDesk does not read (`em`, `ex`, `rem`, `vw`, or unreadable text) fell
  back the same way with no note.

### Decision

1. **One table of absolute units.** The root size and element lengths read the same table: `in`,
   `cm`, `mm`, `Q`, `pt` and `pc`, each with its millimetre and user-unit (CSS px) factor, besides
   unit-less numbers and `px`. Q is 0.25 mm. Each factor keeps the value it had, so no other file
   changes size.
2. **A root size it cannot read is named.** A root `width` or `height` that is present but is
   neither a number, px nor one of those units is still sized as undeclared, as ADR-046 decides,
   and the import notes say so: `SVG size: the root width "10em" is not a length KerfDesk can size
   (it reads px, mm, cm, Q, in, pt and pc), so that axis was sized without it. Check the imported
   size before cutting.` The import shows it as a warning toast, beside the `SVG presentation:`
   notes.
3. **A percentage and `auto` stay silent.** They are relative to a page the file does not define
   (`auto` is 100% for the root), and sizing them from the viewBox is ADR-046's documented rule,
   not a lost size.

### Consequences

- A relative root unit is named, not resolved: KerfDesk does not take `em` as the browser's
  default 16 px, since a style sheet can change it.
- The other import unit tables were checked for the same gap. DXF already reports an unrecognised
  `$INSUNITS` and assumes millimetres; HPGL (40 units/mm) and PDF (points) have fixed units; the
  numeric entry fields' units are typed input, not file import.
- Code and test evidence (`io/svg/svg-units.test.ts`, `ui/app/import-toasts.test.ts`); the
  Chromium size is the audit's and its refuter's measurement.
