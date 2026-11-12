## ADR-705 Amendment 5 - Flat-bed speed steps are said (2026-11-12)

**Status:** Accepted. Amends ADR-705 (Moshiboard over a CH341 USB link), decision 3, and extends
the 95–105 % dose band of Amendment 1 to flat-bed jobs. Fixes Oracle audit O1 finding O8-P2-1.
**Simulator-tested only; not qualified on hardware.** | **Date:** 2026-11-12

### Context

A Moshi program carries its speed in one byte. MeerK40t's builder, which these bytes follow,
writes vector speed as `int(speed)` in whole mm/s clamped to 1..256 (`builder.py` L392-397) and
raster speed as whole cm/s, rounded, at least 1 (L399-412). So a layer speed between two steps
runs at a neighbouring one. The audit drove projects through `prepareOutput` and
`emitPreparedMoshiJob`:

- Lines at 599 mm/min (9.98 mm/s) ran at 9 mm/s; 150 mm/min ran at 2 mm/s (−20 %).
- Images at 1000 mm/min (16.7 mm/s) ran at 20 mm/s; 900 mm/min at 20 (+33 %); 240 mm/min at 10
  mm/s (2.5×), a visibly lighter engrave.

The rotary path already warned when the dose left 95–105 % (Amendment 1). The flat-bed path said
nothing, and the Moshi route has no Job Review.

### Decision

1. **Bytes unchanged.** The speed bytes stay MeerK40t's. One function per header
   (`moshiVectorSpeedMmS`, `moshiRasterSpeedCmS`) now gives both the byte and the speed the job
   reports, so the two cannot disagree.
2. **Said, not hidden.** When a Line, Fill or Image layer's set speed runs at a speed that leaves
   the dose outside 95–105 %, the job gets a warning naming the set speed, the speed the board runs
   and the dose share, for example "a Moshiboard runs images in whole cm/s, so 16.67 mm/s runs at
   20 mm/s (83 % of the set dose)". Warnings never refuse. A speed above the byte's maximum keeps
   its existing note instead.
3. **Not changed, listed for the maintainer.** Rounding line speeds to the nearest mm/s instead of
   truncating would move bytes away from MeerK40t and turn overburn into underburn. MeerK40t's raster
   speed truncates to whole mm/s before Python's half-to-even rounding, so at 25, 45, 65 … mm/s it
   writes one cm/s less than KerfDesk (O8-P3, see the O8 report). Matching it changes bytes and is
   left to the maintainer.

### Evidence

`moshi-job-encoder.test.ts` "flat-bed speed steps": 599 mm/min lines and 1000 mm/min images get
the warning with the decoded speed; 1500 mm/min lines, 1000 mm/min lines (104 %) and 6000 mm/min
images do not; the 599 mm/min program still decodes to 9 mm/s. The ADR-705 golden bytes still
pass. Before the change both warning tests failed.
