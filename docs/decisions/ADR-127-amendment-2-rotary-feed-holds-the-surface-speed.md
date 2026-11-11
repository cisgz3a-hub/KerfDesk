## ADR-127 Amendment 2 - A rotary job's feed holds the layer speed on the part's surface (2026-11-10)

**Status:** Accepted. | **Date:** 2026-11-10

Amends ADR-127's Decision "Scale is applied AFTER prepareOutput … only emitted motion is scaled".
Y distances keep ADR-127's scale and Amendment 1's anchor. What changes is the feed: on a Y-port
rotary whose Y scale is not 1, each burn move's `F` is now the machine feed that moves the part's
surface at the layer speed. Rolling audit v12 X8-P1-1 (2026-11-09) raised this.

### Context

ADR-127 maps surface millimetres to machine millimetres and asks every consumer of machine motion
to use that mapping. The layer Speed was the one quantity left unmapped. It went out as `F`
unchanged, so on a rotary it was a machine-mm speed.

GRBL 1.1, grblHAL, FluidNC, Marlin and Smoothieware time a `G1` by the length of its commanded XYZ
vector: a move of `(dx, dy)` at `F` takes `hypot(dx, dy) / F` minutes. For example, GRBL's
planner divides the block's millimetre length by the programmed rate. On a Y-port rotary, the
same move turns the part's surface `(dx, dy / k)`, where `k` is machine Y mm per surface mm. A
stroke round the part therefore moved its surface at `F / k`:

- **Creality chuck preset on an Ø80 glass:** 40 mm per turn, `k = 0.159`. A 1,500 mm/min Line ran
  9,425 mm/min round the glass, which is 15.9 % of the energy of a stroke along it. A 90° Fill got
  16 % and a 45° Fill 72 %.
- **Stock roller, Ø25, 40 mm per turn:** `k = 0.509`, about 2× too fast.
- **`k > 1` overburned instead** (the X8 refuter's table): a Ø10 pen in the same chuck got 127 %
  of the set energy round the part, a geared roller (150 mm per turn, Ø25) 184 %, and the
  never-edited new roller (360 mm per turn, Ø25) 458 %. On glass, overburning risks chipping.
- **Job Review** said only "Y ×0.16" and warned nothing.

KerfDesk's own G-code inspector already modelled this correctly. `burn-grid.ts`'s `surfaceFeed`
divides by the surface length, so the inspector and the emitter disagreed about the same program.

LightBurn's rotary docs do not say whether it converts the feed, and forum reports disagree. Parity
cannot settle this, so the decision follows the layer contract: Speed is the speed across the
material, as it is on a flat bed.

### Decision

1. **The machine-space job carries its scale.** `applyRotaryYScale` sets `Job.rotarySurfaceYScale`
   to `k` whenever `k ≠ 1`. A surface-calibrated roller (`k = 1`) and a disabled rotary get no
   field.
2. **Each burn move's feed is matched to the surface.** For a move `(dx, dy)` in machine mm, the
   GRBL-family emitter (GRBL, grblHAL, FluidNC, Falcon, and Marlin and Smoothieware through it)
   writes `F = layer speed × hypot(dx, dy) / hypot(dx, dy / k)`
   (`core/output/rotary-surface-feed.ts`). This is the inverse of the inspector's `surfaceFeed`.
   - The ratio is taken from the 3-decimal coordinates the move is written with.
   - Feeds keep the shared whole-number rounding (`effectiveGcodeFeedMmPerMin`), which can only
     lower a feed, by under 1 mm/min.
   - Collinear laser-off runways (ADR-239 entry and exit, the Fill lead-in and lead-out) take the
     feed of the burn they continue.
   - A Fill sweep lies on one line, so it gets one feed.
   - With modal feed, `F` is written again only when it changes.
3. **Rows along X keep their bytes.** A move with `dy = 0` has a ratio of exactly 1. Image rows run
   along X (ADR-492 item 9), and an image-only rotary job gets no feed match, so its output is
   byte-identical.
4. **The feed never exceeds the Max feed.** When `k > 1` (a roller set up with a long travel per
   turn), a stroke round the part needs `k ×` the layer speed. Above the profile's Max feed the
   emitter holds the Max feed. Job Review then warns that those strokes run slower on the part,
   and names the layer speed that keeps the burn even.
5. **The twins follow the program.** The ETA and the inspector both read the emitted program, so
   they now time and shade these moves at the surface speed. Job Review's Rotary fact adds "each
   move's feed holds the layer speed on the part" when `k ≠ 1`. The program carries one comment
   line saying why `F` changes inside a layer.

Out of scope, unchanged:

- **Ruida `.rd`.** It has a per-layer speed, not a per-move one. _Corrected by Amendment 5:_ the
  export applies KerfDesk's own Y scale (`machineSpaceJob`), not the controller's rotary settings,
  so this was not out of scope. Amendment 5 matches its speeds.
- **Scan offset** (ADR-052). It is still chosen from the layer speed.
- **A dedicated A/Z rotary axis** (X8-P2-1, built separately). It writes the turn under another
  letter and needs its own feed rule for its units.

### Same change, rolling audit v12 X8 P3s

- **X8-P3-1.** The more-than-one-turn warning speaks surface mm and turns. For example: "The
  artwork wraps 270.0 mm round the part (1.07 turns), more than one turn of the Ø80 mm object
  (251.3 mm)". It no longer says 42.972 against 40.000 machine mm.
- **X8-P3-2.** After an Abort on a rotary, Frame's origin offer describes the part's turn in
  degrees, with the X offset still as head distance. On rollers it adds that the part may have
  slipped.
- **X8-P3-4.** The jog pad has a **Turn the part** row while a rotary is on. It offers 1-180° steps
  and shows how much surface each step moves. It sends the pad's own Y jog, sized to that share of
  one turn, with the sign flipped by Reverse.

### Consequences

- Rotary vector and angled-fill output changes bytes. Rotary image output, flat-bed output and
  surface-calibrated rollers do not.
- A stroke round the part burns with the same energy per surface mm as a stroke along it. Tests
  simulate this from the emitted G-code on six controllers and three setups.
- On the chuck, those strokes now take `1 / k` times longer than before (6.3× on the Creality
  preset), and the ETA shows it.
- **Returning users: a deliberate burn change.** A rotary project saved by 1.0.29 or 1.0.30 opens
  unchanged, but its line, cut and fill moves now run at the layer speed on the part. So they burn
  darker (chuck, small scale) or lighter (k > 1 rollers, small parts) than those releases burned
  them; image rows do not change.
  - The returning-user tests (`returning-user-rotary-1-0-30.test.ts`) keep 1.0.30's hashes. With the
    feed match switched off, every program must still hash to 1.0.30's, which pins geometry, power,
    order and image rows.
  - With the match on, only F words may differ, image lines not at all, and each lit move's new F
    must move the surface at the feed 1.0.30 wrote for it.
  - The sidecars are not rewritten.
- **HARDWARE-GATED / CLAIMED.** The rule follows the controllers' documented feed semantics, but no
  physical rotary has burned with it yet, as for ADR-127 itself.

### With a taper (ADR-694)

The taper warp scales Y by `f(x) = R_ref / r(x)` before `k`. A machine Y move at X then turns the
part's surface at radius `r(x)` by `ΔY / (k · f(x))`, so the local scale is `k · f(x)`.

- The feed match carries the taper's profile and uses `k · rotaryTaperYFactorAt(profile, midpoint X)`
  for each move. It applies on a taper even when `k = 1`.
- On the Ø80 → Ø70 tumbler a stroke round the part at the rim and one at the base both move the
  surface at the layer speed, so they get equal dose. Without the factor the base ran at 87 %.
- A Fill sweep still takes one feed from its midpoint X. On an angled hatch along a taper, its far
  ends are then a few percent off. A 90° hatch has a constant X and is exact.
