## ADR-127 Amendment 5 - A Ruida .rd file matches rotary speeds to the part's surface, one part per speed class (2026-11-11)

**Status:** Accepted. | **Date:** 2026-11-11

Amends ADR-127 Amendment 2. It takes Ruida `.rd` out of that amendment's "out of scope" list and
corrects the reason given there. Code quality audit C2 D2-P1-2 (P1) and D2-P3-5 raised this; the
refuter confirmed it.

### Context

- The `.rd` export, both a saved file and the network route, runs the job through
  `machineSpaceJob`, which scales Y by `k` exactly as the G-code emitter does.
- The `.rd` writer then wrote one `speedLaser1(group.speed)` per layer. Nothing in `io/rd` or
  `controllers/ruida` read the surface-feed match that the G-code emitter and the Moshiboard encoder
  (ADR-705 Amendment 1) use.
- So on a Y-port rotary, strokes round the part moved the surface at speed ÷ `k`:
  - 15.9 % of the set dose round an Ø80 glass in a 40 mm-per-turn chuck;
  - 458 % round an Ø25 pen in a 360 mm-per-turn chuck.
- Amendment 2 had called Ruida out of scope because it "uses the controller's own rotary
  settings". That was wrong: the export applies KerfDesk's own scale. The ADR line never reached
  the operator.

### Decision

1. **One part per speed class** (`core/controllers/ruida/rd-rotary-feed.ts`).
   - When the machine-space job has a feed match (a scaled rotary, or a taper), each `.rd` layer is
     split. Every cut is classed by the feed that moves the part's surface at the layer speed, the
     same `surfaceMatchedFeed` and `surfaceFeedDoseRise` the G-code emitter uses.
   - The classes are geometric steps 5 % apart. Each class becomes its own part at that speed.
   - Within a part, cuts keep their order, and a laser-off move reaches each one.
   - No mid-layer speed command is used, because none is verified on a controller.
2. **Bounded.** A Ruida file holds 100 parts. If the 5 % classes need more, the export retries with
   10 % classes, then 20 %. Beyond that it produces no file and says to use fewer vector layers or
   G-code.
3. **Said when it shows.** When the classes leave a cut outside 95–105 % of the set dose, the export
   adds an advisory naming the range.
4. **Rotary Setup on a Ruida** says that KerfDesk writes the rotary into the `.rd` file itself, and
   that the controller's own rotary function should stay off or Y may be scaled twice. It also says
   this has not been checked on a Ruida machine yet.

### Consequences

- Decoded with the meerk40t-faithful test decoder, every stroke of a square and a circle burns
  within 2.5 % of the set surface speed on the 40 mm Ø80 chuck, the 360 mm Ø25 pen and a reversed
  chuck.
- A job without a scaled rotary, including a surface-calibrated roller, keeps one part per layer
  and its bytes.
- A rotary layer now runs as several parts, so the head moves between them. The burn order changes,
  but each stroke's place does not.
- **Hardware-gated / claimed,** as for ADR-127: no Ruida with a rotary has run it.
