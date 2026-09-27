## ADR-224 Amendment 3 - A relief operation's Job Review line names the levels the job cuts (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

ADR-224 carries two unnumbered amendments in `DECISIONS.md` (partial compiled operation summary,
2026-08-02; explicit settings approval, 2026-08-09). This is the third.

### Context

The v2 revision gave every Artwork settings row in Job Review a muted detail line. For CNC it is
built from the operation's settings alone: a pass count from Cut depth and Depth/pass, then
stepover, direction, tabs, entry, allowance, strategy and feeds. A relief does not cut to Cut
depth. It roughs to its own depth in Z levels (ADR-422) and takes no tabs. The operation panel
already says that Cut depth applies to the other shapes only.

A layer holding only a 20 mm flat relief 3 mm deep, on the default profile-on-path operation (Cut
depth 1 mm, 1.5 mm per pass, tabs on), read `1 pass · stepover 40% · tabs 4 per shape (6 × 2 mm) ·
Manual feeds`. The compiled job roughs that relief at 1.5 mm and 2.5 mm, the floor less the 0.5 mm
roughing allowance, with no tabs. This was found while working on ADR-273 Amendment 1 (PR #957).

### Decision

1. The line takes its relief facts from the exact prepared job, as the partial compiled summary
   does. It uses the distinct depths that the operation's relief roughing groups cut at, read from
   their emitted passes, and whether the operation compiled any group that is not a relief group.
   A ramped pass counts at the depth its ramp descends to.
2. An operation that cut reliefs starts its line with `relief roughing N levels to D mm`, where D
   is the deepest level. If its reliefs compiled only a finishing pass, the line starts with
   `no relief roughing levels`.
3. When the operation cut only reliefs, the line leaves out the parts that describe its cut
   type's shapes: the pass count or V-carve depth, tabs, V-carve clearing and pocket strategy.
   Stepover, direction, entry, allowance and feeds stay. Stepover also shows on a V-carve
   operation, because the relief rings step by it.
4. When the operation also cut other shapes, the pass count reads `N passes on the other shapes`.
   Tabs that are kept add `, none on reliefs`.
5. Operations without relief groups read exactly as before. The line stays informational. It adds
   no warning, refusal or Start gate, and it changes no compiled or streamed byte.

### Consequences

- A relief row's line agrees with the compiled summary under it, for example `Actual max depth
  2.5 mm`.
- With several reliefs on one operation, the level count is of distinct depths across all of
  them, not per relief.
- The Cut and Depth mm columns still show the operation's settings. The line now says which
  shapes they reach.
- The requested entry stays as the settings describe it. ADR-273 Amendment 1 notes, from the same
  compiled job, the relief stages that plunge instead. A relief-only operation with a 5° ramp and
  a finishing bit reads `relief roughing 2 levels to 2.5 mm · stepover 40% · ramp entry 5° (relief
  finishing plunges) · Manual feeds`.
