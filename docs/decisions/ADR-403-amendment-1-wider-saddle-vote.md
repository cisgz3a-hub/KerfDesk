## ADR-403 Amendment 1 - A 4x4 saddle tie widens to a 6x6 and an 8x8 ring (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Clean-room constraint (ADR-120, ADR-123) unchanged. The idea of widening the neighbourhood when the
local vote ties comes from the clean-room notes only: `potrace-learnings.md` section 1.2 cause 5 and
section 3 item 12, and the audited reports R1 section 2.3 and R3 section 2. No tracer source was
read; Potrace 1.16 was only run as a binary on the same fixtures.

### Context

Under ADR-403, `'auto'` decides a diagonal contact from the 4x4 source-pixel window centred on the
corner and falls back to the grey decider, then to paper, when that window is exactly half ink.
Bake-off harness v4 counted these 4x4 ties at 8-11% of all contacts on the hard photos: 239 of 2475
on photo 03, 2017 of 18179 on 08, 104 of 1311 on 13 and 1411 of 15984 on 17. On owl the count is
25572 of 301451 (O-default). Nearly all of these ties (85-94%) are no longer balanced in a 6x6
window, so the fixed fallback was deciding contacts that wider structure could settle.

### Decision

1. **Wider rings after a 4x4 tie.** The 4x4 window still decides whenever it is unbalanced, exactly
   as before. After a tie, `'auto'` tries the 6x6 and then the 8x8 window, in source pixels (times
   `pixelScale` in mask pixels). Each window is centred on the corner and shrinks per axis at the
   image border, exactly like the 4x4 window. The vote stops once the border stops both axes from
   growing.
2. **Each wider window counts only the ring it adds, and that ring must be at least 7/8 one
   colour** (`4 * |ring ink - ring paper| >= 3 * ring area`). The minority colour of a decisive
   ring keeps its diagonal. Two marks kissing on a page, or two pinholes kissing in solid ink,
   have a uniform ring, so they are decided. At the rim of a checkerboard patch the ring holds
   cells on one side and page on the other, so it is mixed and the contact stays a tie.
3. **The final fallback is unchanged:** the grey decider with its 2-level margin, then paper. The
   same applies when every window ties, for example on a checkerboard of any cell size or two equal
   shapes filling the image.
4. `'connect-ink'` and `'connect-paper'` are unchanged. Output is byte-identical wherever no 4x4
   tie occurs, because the new code runs only after a 4x4 tie.

### Evidence

All runs use bake-off harness v4 on the `a10013827` base. Reference: Potrace `P-default`.

**Which rule decides a wider window.** Three rules were measured.

| Rule | topology.clean O-default mean deviation | topology.clean O-sharp mean deviation | Photo 08 IoU | Verdict |
| --- | --- | --- | --- | --- |
| A: the first unbalanced whole window decides | +8.3% (0.0935 to 0.1012) | +7.9% | -0.0031 | fails both gates |
| V2: a whole window decides if 2\|balance\| >= ring area (3/4) | +8.3% | +7.9% | not run | fails the deviation gate |
| **V3: the ring alone decides at >= 7/8 one colour (adopted)** | **0.0%** | **0.0%** | **-0.0007** | **passes** |

Why A fails: topology.clean has a 16x16-px patch of 2-px checkerboard cells on white. At the rim,
the 6x6 and 8x8 windows reach the white page, so ink becomes the minority and the rim cells weld.
Outers drop from 40 to 17 and holes rise from 3 to 4, against a truth of 40 outers and 3 holes
(Potrace gives 8 and 5). The unit test models the rim with a 12x12 patch. There its rings are up
to 16 of 20 paper at 6x6 and 24 of 28 at 8x8, an imbalance of at most 0.71 of the ring area. V2
still decides at the rim, because it tests the whole window: at corner (6,6) the 6x6 window holds
13 ink of 36, and 2 x 10 >= 20. V3 requires 0.75, so every rim contact stays a tie. The margin is
small.
The unit test "lets a wider ring decide only when at least 7/8 of it is one
colour" pins this case.

**Final tie rule.** Two candidates were measured. The first is today's rule (grey decider, then
paper). The second, rule B, joins ink on a full tie when the image's ink fraction is below one
half.

- Rule B changed nothing measurable on photos 03, 08, 13 and 17. IoU and deviation matched to
  4 dp, and the census moved by at most one component.
- Rule B also broke ADR-403 guards: two squares kissing at a corner became one outline, and a 1-px
  checkerboard patch welded in Line Art and Smooth.
- Under rule A, full ties after 8x8 were only 7, 5, 3 and 16 contacts on 03, 08, 13 and 17.

Today's fallback is kept.

**Identity proof.** The serialised trace was hashed on 57 analytic images plus owl and
hummingbird, for O-default, O-smooth and O-sharp: 171 rows. 164 rows are identical and 7 differ.
All 7 differing rows have 4x4 ties (text-small/clean O-sharp, owl and hummingbird in all three
presets). No row without a 4x4 tie differs. Under V3, owl O-default has 25572 ties, of which the
ring decides 432 at 6x6 and 721 at 8x8, and 24419 fall through to the fallback. For hummingbird
O-default the figures are 39551, 331, 619 and 38601. So photo ties are mostly inside mixed texture,
where no ring is 7/8 one colour.

**Regression set** (P-default, O-default, O-smooth, O-sharp; base against V3). Worst IoU drop:
-0.0002 (text-small.clean O-sharp). Worst mean-deviation rise: +0.07% (hummingbird O-smooth).
topology.clean and topology.scan are identical to base in every preset, and topology misses stay
0. The owl and hummingbird census moved by at most 4 components per bucket.

**Hard photos, O-default.** The census is retained ink/holes at 1-2, 3-8 and 9-32 px. "Outers"
counts traced outers at 1-8 px.

| Photo | IoU base to V3 | Mean deviation | Census base | Census V3 | Outers base to V3 (Potrace) |
| --- | --- | --- | --- | --- | --- |
| 03 | .8761 to .8760 | +0.1% | 856/43, 544/268, 411/584 | 857/43, 544/268, 412/584 | 37 to 36 (1319) |
| 08 | .5840 to .5833 | +0.2% | 7577/11, 1411/851, 377/4551 | 7592/11, 1412/851, 377/4551 | 961 to 956 (1787) |
| 13 | .9290 to .9290 | 0.0% | 729/403, 363/38, 462/21 | 729/402, 363/38, 462/21 | 0 to 0 (2139) |
| 17 | .8438 to .8438 | 0.0% | 1242/1180, 1406/1735, 924/2204 | 1242/1180, 1406/1739, 924/2204 | 1442 to 1434 (2718) |

For comparison, rule A moved the census further: 08 1-2 px ink went 7577 to 7661, and 17 3-8 px
holes went 1735 to 1749. Rule A also merged marks, cutting outers by 3% (961 to 917 on 08). It paid
for that with the two gate failures above. On the ADR-448 route, rule A held photo 08 (.8986) and
improved 17 (.9003 to .9025), so the 08 drop is specific to the old over-inked sketch route. V3 is
the rule that holds every gate on both routes' fixtures.

**Runtime.** The hash suite took 34.2 s on base and 32.8 s with V3, which is within the noise of
the overloaded machine.

### Consequences

- Isolated marks and pinholes that kiss at a corner, with clean surroundings, now keep their thin
  diagonal instead of falling to paper. This holds at the border too, per axis.
- Checkerboards, dithers and photo texture keep today's answer: their rings are mixed, so the
  fallback still decides them. The measurable effect on photos is therefore small (within 1% on
  every census bucket and outer count). The census and outers hold rather than move toward
  Potrace.
- A looser ring threshold would join more photo contacts, but at 0.71 or below it welds the
  topology checkerboard rim. Reopen this only with a fixture that separates texture from marks
  better than ring uniformity does.
- One existing assertion changed on purpose. At pixel scale 1, the 2x-enlarged hairline was a blind
  4x4 tie. Its 6x6 ring is 18 of 20 paper beyond the balanced 4x4, so it now joins, while the
  enlarged checkerboard stays split.
