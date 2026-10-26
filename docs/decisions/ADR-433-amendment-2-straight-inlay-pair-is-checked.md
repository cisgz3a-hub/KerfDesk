## ADR-433 Amendment 2 - A straight inlay pair is checked for narrow parts and gaps (2026-10-23)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-10-23

Amends ADR-433 decision 1, which skipped inlay operations. Fixes CNC audit v1 F5-P2-3
(`docs/audits/2026-10-23-cnc-v1/F5-cnc-inlay.md`). The findings stay Job Review warnings and the
fresh-trace notice; nothing blocks Frame or Start (ADR-228).

### Context

A straight inlay pair cuts both halves from one design closed and then opened by the bit radius
(ADR-155, `planStraightInlayPair`). A part narrower than the bit therefore leaves both the pocket
and the insert, and a gap narrower than the bit is closed in both. The audit compiled 40 mm Roboto
"AB" with the default 1/8" end mill: 59.5 of 526 mm² was cut in neither half and the B insert came
out in two pieces. The same artwork as a plain pocket drew three ADR-433 warnings; as an inlay pair
it drew none, because `CNC_SIDES` had no inlay entry.

### Decision

1. **An end-mill straight pair is checked like an on-path profile**: parts and gaps, against the
   bit's diameter, on the artwork compile reads. A pair that compile refuses (a bit other than an
   end mill) is not checked; the inlay issue already explains it.
2. **A tapered pair is still skipped.** It V-carves its detail into both pieces (ADR-665), as a
   V-carve operation does.
3. **The warning says what the pair does.** A narrow part: "the bit cannot enter it, so the pocket
   and the insert both leave it out". A narrow gap: "the bit cannot fit into it, so the pocket and
   the insert both close it up". The fresh-trace notice keeps its general wording ("the bit cannot
   cut them as drawn").

### Verification

`src/core/min-feature/project-check.test.ts`: a 2 mm part beside a 10 mm part, paired with a 3 mm
end mill, gives one 2 mm area, and the pair's plan has no pocket over the narrow part. Two 6 mm
parts 2 mm apart give one 2 mm gap, and the plan merges them into one pocket. A tapered pair and a
straight pair with a V-bit give no report. `src/ui/laser/job-review/min-feature-warnings.test.ts`
checks the wording. Without the change the inlay pair returns no report and both tests fail.
