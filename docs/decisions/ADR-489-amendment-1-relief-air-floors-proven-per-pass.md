## ADR-489 Amendment 1 - Relief air floors require an exact repeated output path (2026-09-28)

**Status:** Accepted; software verification only, hardware qualification pending.

Amends ADR-489 item 3. Frame remains the sole ordinary Start policy gate. This changes only
which optional fast Z descents the producer can prove; an unproved pass feeds from safe Z.

### Why the region argument was insufficient

The original ladder assumed the preceding level cleared everything within the next path's
cutter envelope. CI seeds 594578632 and 1167848472 demonstrated uncut stock beyond prior rings.
An initial geometric replacement expanded swept paths by 0.01 mm, and its simulation expanded
the cutter by the same amount. The PR audit reproduced a false floor for a 0.001 mm sideways
shift. A thin stock strip can still be tall; cutter tolerance cannot prove it has disappeared.

Removing that expansion was insufficient. An exact source-space subsegment can acquire a new
off-line vertex when G-code coordinates are rounded. A later shared translation or reflection
can change which side of the output grid a vertex lands on. Proving a polygon union before
final output placement therefore cannot establish the claimed represented clearance.

### Decision

`keepProvenAirFloors` accepts a candidate floor only when an earlier pass of the same output
primitive used the **identical full XY vertex sequence**, and its entire path was at or below
the candidate's slice top. Contours compare with contours and path3d passes with path3d passes.
Identical source geometry retains identical output coordinates and the same contour precision
selection under a later shared placement. The proof does not invent an edge from `closed`:
the emitter only cuts the vertices actually supplied.

The earlier pass must be executable; a contour that the emitter omits and a path3d pass with
fewer than two points do not count. Both requested and represented highest Z are checked.
The resulting floor preserves the cutter rise and rounds upward so it cannot sit below the
stock height actually represented. An absent or invalid cutter radius still disables floors.

Subpaths, restarted paths, offset regions, mixed output primitives and ramps with any part
above the ceiling do not gain a floor. This deliberately narrows the optimisation. A broader
proof requires ownership of the final placed output geometry and is deferred.

No geometry offsets, eroded unions or tolerance-expanded stock simulations remain in the
proof. The earlier dense-region argument-limit failure is removed with that implementation.
The stock oracle uses the actual cutter radius and imports no tolerance from production code.

### Verification and consequences

- Tests retain the uncut-strip failures, the two CI reliefs and the doubled-back ramp fixture.
- Emitted-program tests cover raw-collinear subdivision, post-proof translation and reflection,
  and positive exact repeats under the same transforms.
- A 150,000-vertex exact repeat proves without offset allocation or argument spreads.
- Exact repeated contours/path3d passes retain fast descents. Changing dome, mask and ramp
  sections without a complete repeated path explicitly lose the optimisation.
- Actual-radius removal simulation still checks every retained floor, including positive
  high-stepover ball-nose, V-bit and repeated-outline cases.
- Earlier candidate benchmarks and byte-identity counts do not describe this narrower version.
  More entries may feed all the way from safe Z, intentionally increasing time for unproved cases.
- Output revision: `relief-repeated-paths-20260928-v13`.

Recovery and clipping must remove clearance certificates when preceding cuts are unavailable.
No controller interpolation, air cut, material or physical-machine qualification is claimed.
