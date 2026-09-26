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

1. **Wider rings after a 4x4 tie that grey evidence cannot settle.** The 4x4 window still decides
   whenever it is unbalanced, exactly as before. After a tie the grey decider (Nielson-Hamann, with
   its 2-level margin) goes first, as before. Only when it has no verdict (a binary source, a
   saturated block, a value within the margin) does `'auto'` try the 6x6 and then the 8x8 window,
   in source pixels (times `pixelScale` in mask pixels). Each window is centred on the corner and
   shrinks per axis at the image border, exactly like the 4x4 window. The vote stops once the
   border stops both axes from growing.
2. **Each wider window counts only the ring it adds, and that ring must be at least 7/8 one
   colour** (`4 * |ring ink - ring paper| >= 3 * ring area`). The minority colour of a decisive
   ring keeps its diagonal. Two marks kissing on a page, or two pinholes kissing in solid ink,
   have a uniform ring, so they are decided. At the rim of a checkerboard patch the ring holds
   cells on one side and page on the other, so it is mixed and the contact stays a tie.
3. **The final fallback is unchanged:** paper. It decides when the grey decider is silent and every
   window ties, for example on a binary checkerboard of any cell size or two equal shapes filling
   the image.
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

**Grey decider before or after the rings.** The first V3 commit let a decisive ring override the
grey decider. A counter on every resolver consult of an O-default bake-off run recorded the grey
verdict on each tie that a ring decided.

| Fixture | Ties decided by a ring | Grey agrees | Grey disagrees | Grey silent | Disagree share of grey verdicts |
| --- | --- | --- | --- | --- | --- |
| Photo 03 | 5103 | 3188 | 817 | 1098 | 20% |
| Photo 08 | 25817 | 13162 | 9582 | 3073 | 42% |
| Photo 13 | 6539 | 4097 | 593 | 1849 | 13% |
| Photo 17 | 4826 | 3491 | 1195 | 140 | 26% |
| Owl | 2845 | 2406 | 398 | 41 | 14% |
| Hummingbird | 2218 | 1726 | 419 | 73 | 20% |

The disagreements are not rare, and they are densest on photo 08, the anti-aliased stipple
engraving. So a variant (V4) consulted the grey decider first and the rings only when it was
silent. Against the ring-first V3, V4 raised 08 IoU from .5833 to .5835 (deviation -0.1%) and
text-small.clean O-sharp from .8068 to .8070. Photos 03, 13 and 17, owl, hummingbird and the
topology fixtures moved by at most 0.0001 IoU and 5 components. The ADR-403 rationale for putting
the 4x4 window before the grey decider is the 1-px anti-aliased diagonal, where the 4x4 window is
already decisive; it does not extend to the wider rings. V4 is adopted: the rings now settle only
the ties that carry no grey evidence, which is where the binary-mark case lives.

**Final tie rule.** This was measured on top of the wider rings (V3). The contacts that reach the
fallback are the same under V3 and V4: a 4x4 tie that no ring settles and the grey decider leaves
open. Under V3 the grey decider plus fallback decide most ties: 41464 of 46567 ties on photo 03,
200705 of 226522 on 08, 48706 of 55245 on 13 and 165845 of 170671 on 17. That is 5.5-10.1% of
all contacts, counted over every resolver consult of an O-default bake-off run. Two fallbacks were compared. The first is today's rule (grey decider,
then paper). The second, rule B', keeps the grey decider and then joins ink, instead of paper,
when the image's ink fraction is below one half (connect the sparse colour).

| Fixture, O-default | IoU, today to B' | Mean deviation | Census change | Outers 1-8 px (Potrace) |
| --- | --- | --- | --- | --- |
| Photo 03 | .8760 to .8758 | +0.1% | ink 1-2 px 857 to 871, 3-8 px 544 to 556 | 36 to 36 (1319) |
| Photo 08 | .5833 to .5814 | +0.6% | ink 1-2 px 7592 to 7637 | 956 to 935 (1787) |
| Photo 13 | identical | identical | none | 0 to 0 (2139) |
| Photo 17 | .8438 to .8436 | +0.1% | ink 1-2 px 1242 to 1251; holes 1-2 px 1180 to 1166, 3-8 px 1739 to 1728 | 1434 to 1400 (2718) |
| topology.clean | .9823 to .9789 | +19.1% | welds kissing squares | - |

Owl outers at 1-8 px went from 1891 to 1877, and hummingbird from 1404 to 1395. Rule B' fails the
IoU gate (-0.0033) and the deviation gate (+19.1%) on topology.clean. It moves the 1-8 px outers
away from Potrace on every photo, because joining ink merges marks. It also breaks ADR-403 guards:
two squares kissing at a corner become one outline, and a 1-px checkerboard patch welds in Line
Art and Smooth. Those guard cases are full ties under every rule tried, so the fallback alone
decides them. Today's fallback is kept.

An earlier probe of rule B on top of the rejected rule A found no measurable photo change. That
result does not carry over to V3: under rule A the wider windows decided almost every tie, and only
7, 5, 3 and 16 contacts on 03, 08, 13 and 17 reached the fallback.

**Identity proof.** The serialised trace was hashed on 57 analytic images plus owl and
hummingbird, for O-default, O-smooth and O-sharp: 171 rows. 164 rows are identical and 7 differ.
All 7 differing rows have 4x4 ties (text-small/clean O-sharp, owl and hummingbird in all three
presets). No row without a 4x4 tie differs. Under V3, owl O-default has 25572 ties, of which the
ring decides 432 at 6x6 and 721 at 8x8, and 24419 fall through to the fallback. For hummingbird
O-default the figures are 39551, 331, 619 and 38601. So photo ties are mostly inside mixed texture,
where no ring is 7/8 one colour. The proof was hashed on V3. It holds for V4 by construction: both
change only the code that runs after a 4x4 tie, and V4 differs from V3 only on ties the grey
decider settles.

**Regression set** (P-default, O-default, O-smooth, O-sharp). Base against V3: worst IoU drop
-0.0002 (text-small.clean O-sharp), worst mean-deviation rise +0.07% (hummingbird O-smooth). Base
against the adopted V4: worst IoU drop -0.00005 (hummingbird O-sharp against V3; text-small.clean
O-sharp is back to .8070), worst mean-deviation rise +0.07%. topology.clean and topology.scan are
identical to base in every preset under both, and topology misses stay 0. The owl and hummingbird
census moved by at most 4 components per bucket.

**Hard photos, O-default.** The census is retained ink/holes at 1-2, 3-8 and 9-32 px. "Outers"
counts traced outers at 1-8 px.

| Photo | IoU base, V3, V4 | Mean deviation V4 | Census base | Census V4 | Outers base, V3, V4 (Potrace) |
| --- | --- | --- | --- | --- | --- |
| 03 | .8761, .8760, .8760 | +0.1% | 856/43, 544/268, 411/584 | 857/43, 544/268, 412/584 | 37, 36, 36 (1319) |
| 08 | .5840, .5833, .5835 | +0.1% | 7577/11, 1411/851, 377/4551 | 7589/11, 1411/851, 377/4551 | 961, 956, 957 (1787) |
| 13 | .9290, .9290, .9290 | 0.0% | 729/403, 363/38, 462/21 | 729/402, 363/38, 462/21 | 0, 0, 0 (2139) |
| 17 | .8438, .8438, .8438 | 0.0% | 1242/1180, 1406/1735, 924/2204 | 1242/1180, 1406/1735, 924/2204 | 1442, 1434, 1439 (2718) |

For comparison, rule A moved the census further: 08 1-2 px ink went 7577 to 7661, and 17 3-8 px
holes went 1735 to 1749. Rule A also merged marks, cutting outers by 3% (961 to 917 on 08). It paid
for that with the two gate failures above. On the ADR-448 route, rule A held photo 08 (.8986) and
improved 17 (.9003 to .9025), so the 08 drop is specific to the old over-inked sketch route. The
7/8 ring rule, with the grey decider first (V4), holds every gate measured.

**Runtime.** The hash suite took 34.2 s on base and 32.8 s with V3, which is within the noise of
the overloaded machine. That suite never stresses the resolver, so dense checkerboards (dithered
art, where every contact is a full tie) were timed directly: 1024x1024 masks, the resolver called
on every saddle, best of 3. The first V3 commit re-summed each whole window (116 reads per full
tie at scale 1). The shipped code reads only the ring each step adds and stops as soon as the rows
left cannot make that ring 7/8 one colour. It returns the same answer as the first V3 commit on
1.88 M random corners at pixel scales 1 to 3. These masks carry no grey field, so V4 runs the same
ring code; with a field, a tie also pays for the four-sample grey decider, as it did on base.

| Mask, pixel scale | Contacts | a10013827 | V3, whole windows | V3, ring sums (shipped) |
| --- | --- | --- | --- | --- |
| 1-px checkerboard, 1 | 1046529 | 61 ns | 440 ns | 92 ns |
| 2-px checkerboard, 1 | 261121 | 61 ns | 425 ns | 92 ns |
| 2x-enlarged 1-px checkerboard, 2 | 261121 | 212 ns | 1510 ns | 216 ns |

A summed-area table would make every window O(1), but it costs an Int32 per mask pixel for each
of the three resolver stages, on masks as large as the work budget allows. The ring sums already
bring dense checkerboards within 1.5x of base, so no table is built.

### Consequences

- Isolated marks and pinholes that kiss at a corner, with clean surroundings and no grey evidence
  at the corner (a binary source or a saturated block), now keep their thin diagonal instead of
  falling to paper. This holds at the border too, per axis.
- Anti-aliased 4x4 ties keep the grey decider's answer, exactly as on base. The wider rings settle
  only the ties it leaves open.
- Checkerboards, dithers and photo texture keep today's answer: their rings are mixed, so the
  fallback still decides them. One exception: a small 1-px checkerboard patch on a page, 4 to 6 px
  across, is its own balanced 4x4 window, and its 6x6 ring is page. Its central corners now join
  ink, which matches the minority intent for a tiny dither cluster. Patches of 8 px or more, 2-, 3-
  and 4-px cells and inverted patches are unchanged. A unit test pins both cases.
- The 7/8 threshold clears the rim of the topology 2-px checkerboard patch by one pixel: the worst
  rim ring is 24 of 28 paper at 8x8 and the threshold needs 25. One flipped cell pixel next to the
  rim therefore welds that corner. A unit test records this outcome. topology.scan is the
  fixture-level guard, and it is identical to base.
- The measurable effect on photos is small: within 1% on every census bucket and outer count. The
  census and outers hold rather than move toward Potrace.
- A looser ring threshold would join more photo contacts, but at 0.71 or below it welds the
  topology checkerboard rim. Reopen this only with a fixture that separates texture from marks
  better than ring uniformity does.
- One existing assertion changed on purpose. At pixel scale 1, the 2x-enlarged hairline was a blind
  4x4 tie. Its 6x6 ring is 18 of 20 paper beyond the balanced 4x4, so it now joins, while the
  enlarged checkerboard stays split.
