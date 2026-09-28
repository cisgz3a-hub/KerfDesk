## ADR-224 Amendment 4 - An operation that cuts only reliefs shows Relief and its compiled depth (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

Amendment 3 made the detail line under a CNC row in Job Review read its relief facts from the exact
prepared job. It left the Cut and Depth mm cells showing the operation's settings. For an operation
whose compiled job cuts only reliefs, those cells describe nothing that is cut. A layer holding only
a 20 mm flat relief 3 mm deep, on the default On path operation (Cut depth 1 mm, 1.5 mm per pass),
showed Cut `On path` and Depth mm `1`. The relief roughs at 1.5 mm and 2.5 mm, the floor less the
0.5 mm Rough allowance. On a flowing V-carve operation the Depth mm cell showed `Pending`, because
the job had no V-carve group to measure.

Flowing V-carve is the precedent (ADR-285, decision 7). Its depth comes from the artwork width and
the bit, not from Cut depth, so its Depth mm cell shows the compiled maximum depth, for example
`3.175 mm actual`, instead of an inert Cut depth.

### Decision

1. The rule applies when the operation's compiled job cuts reliefs and nothing else, which is
   Amendment 3's `cutsOtherShapes: false`.
2. **Depth mm** shows the deepest compiled relief pass, roughing or finishing, marked `actual`.
   It reuses the flowing V-carve cell and its accessible name, `Actual compiled max depth mm`.
   The value is the deepest emitted Z of the relief groups, read the way the partial compiled
   summary reads `Actual max depth`. Without a finishing bit it is the deepest roughing level,
   `2.5 mm actual` in the example. With one it is where finishing reaches, `3 mm actual`, because
   finishing cuts the allowance roughing leaves. The title says that depth comes from each relief,
   not from Cut depth. It includes any flat cleanup or finishing passes: roughing-bit flat
   cleanup can reach a floor without leaving the roughing allowance there.
3. **Cut** shows `Relief`. Its title names the cut type that reaches no shape, for example
   `This operation cuts only reliefs. Its cut type, On path, applies to other shapes only.`
4. Tool, Depth/pass, Feed, Plunge and RPM keep the operation's settings, because relief roughing
   cuts with them. A finishing bit can carry its own stage recipe, and the partial compiled
   summary shows those values under `Relief finishing`.
5. An operation that also cuts other shapes keeps its cut type and Cut depth, which reach those
   shapes, and Amendment 3's line says so. Operations without reliefs are unchanged.
6. The cells stay informational. They add no warning, refusal or Start gate, and they change no
   compiled or streamed byte.

### Alternatives rejected

- **The deepest roughing level.** It matches the detail line, but it understates the depth when a
  finishing bit cuts below it, and there is none when a relief compiles only a finishing pass.
- **A dash with a title.** It is true, but it hides a compiled fact that Job Review already holds
  and that the flowing V-carve precedent shows.
- **Keeping the cut type beside the relief depth.** `On path` next to `2.5 mm actual` pairs a cut
  type with a depth it never cuts.

### Consequences

- A relief-only row agrees with its detail line (`relief roughing 2 levels to 2.5 mm`) and with the
  partial compiled summary under it (`Actual max depth 2.5 mm`).
- Amendment 3's consequence that the Cut and Depth mm columns show the settings now holds only for
  operations that also cut other shapes.
- `CompiledReliefFacts` gains `maxDepthMm`. `cncActualMaxDepthMm` stays the flowing V-carve depth,
  so a flowing V-carve row that also cuts reliefs still shows only its V-carve depth.
- An operation whose other shapes compile to nothing cuts only its reliefs, so its row shows
  `Relief` too.
- The Tool cell names the roughing bit. The finishing bit is named in the partial compiled summary.
