# CNC audit v3 — areas

**Requested by** the maintainer on 2026-11-13. After the C2 verification round and its P3 sweep finished ([round result](../2026-11-12-c2-verify/LEDGER.md#round-result-2026-11-12)), they chose "New audit area" and then "CNC toolpaths".

**Why.** CNC audit v2 ([J1](../2026-11-11-cnc-v2/LEDGER.md)) ran in one session with no refuter, and all five of its findings are still open. That includes J1-P1-1: default tabs swallow small holes, with no warning. J1 also left these unmeasured:
- relief and 3D;
- tiling;
- surfacing, tool reach and holder clearance;
- object transforms;
- text and curves;
- machine behaviour.

Since then the GRBL simulator has gained a kinematic clock, arcs and write-failure hooks (#1863). A program can now be run, not only read.

## Loop

Each area runs once, one agent at a time:
1. an auditor;
2. a fresh refuter with its own method;
3. the coordinator re-checks every P1 and P2 in main's code;
4. a ledger in a docs pull request;
5. every confirmed P1 or P2 gets a fix, through the session that owns the code (or a new one).

Finding IDs are `N<area>-P<n>-<k>`. Severity follows [METHOD.md §3](../2026-10-21-rolling-v2/METHOD.md): P1 harms a job, loses work or exposes a secret, or lets such a defect reach `main` unchecked. There is no reach clause, and a visible result is not a warning. A test gap behind correct code is P2 at most.

## Areas (run in order)

| # | Area id | Scope | Method |
|---|---|---|---|
| N1 | `j1-refute-and-tabs` | J1-P1-1, J1-P2-1, J1-P3-1..3 (refuter owed), plus every tab path: automatic tabs, manual tab mapping, drag tabs, fully tabbed loops, tab coverage warnings | An independent refutation of each J1 finding with its own G-code reader and material model. Then a sweep of tab count, width and height against hole and part sizes, layer mixes and stock thickness, checking what is cut through, what is left and what Job Review says |
| N2 | `relief-and-3d` | relief roughing and finishing, rest machining, two-sided relief, air floors, stock-bottom warnings | Heightmap oracle: the emitted program swept through a voxel or heightfield stock model against the intended surface, checking gouges, over-depth, uncut stock against the stated scallop, and warnings at the stock bottom |
| N3 | `adaptive-and-pocket` | adaptive pocket (entry, islands, containment, rim arcs, order), helical entry, pocket stock, rest operations | The same stock model: tool engagement (maximum radial load against the setting), no kept material cut, islands kept, entry ramps within the bit's plunge rules, and rest machining picking up only what the larger tool left |
| N4 | `transforms-tiling-reach` | object transforms (rotate, mirror, non-uniform scale), text and curved artwork, tiling against its untiled twin, tool reach and holder clearance, the surfacing wizard, nest spacing | Each transformed or tiled job compared with an identity-transform twin or the untiled program, plus reach and holder checks against deep pockets |
| N5 | `cnc-machine-run` | the program on the GRBL simulator with the kinematic clock (#1863): bit-change holds and multi-tool, park, Z-zero and probing, Abort mid-cut, resume or restart from a line, rapids into uncut stock, the ETA against simulated time | Simulated controllers only. Each job runs to completion and is interrupted at chosen points; position, spindle and stock state are checked after each event |
| N6 | `cnc-review-truth` | Job Review warnings and ETA, the material and bit catalogue (feeds, speeds, chip load), output precision, CNC rotary and wrap | Every warning traced to the condition it claims; catalogue feeds checked against chip-load arithmetic; each CNC rotary job compared with its flat twin |

## Rules

- fresh `git archive` trees with a `node_modules` junction;
- agents report only;
- simulated controllers only; never operate hardware;
- no pnpm, no building or packaging, no live services;
- memory gates: Vitest needs at least 1.5 GB free, a browser at least 2 GB;
- security findings stay redacted until fixed;
- fix PRs use auto-merge with the MERGE method, plus Auto-fix.

J1's G-code oracle can be reused as a second reader: `../2026-11-11-cnc-v2/evidence/oracle.ts.txt`. An auditor and its refuter must not both rely on it.

**Status:** started 2026-11-13. N1–N5 ledgered ([LEDGER.md](LEDGER.md)); N6 next.
