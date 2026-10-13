## ADR-163 Amendment 1 — Coincident entries retain every cut

**Status:** Accepted | **Date:** 2026-10-13

## Context

The current spatial index replaces ADR-163's historical 2,000-segment fallback.
It still rescanned every live entry in an occupied cell. In software stress,
50,000 coincident paths exceeded the unchanged 30-second fixture deadline at
three seeds. Repeated geometry can represent intentional repeated cutting;
removing it is not a performance repair.

## Decision

Index exact coordinate locations, each holding all original entries sorted by
segment index, forward before reverse, then start vertex (absent means zero).
Stable sorting preserves original object identity when those keys also tie.
Coordinates are never rounded. Only the first available entry at a location
can win against another location: every entry there has the same squared
distance from any cursor. Availability remains monotone, and a queue advances
only past retired entries. A query does not consume its winner.

Size the grid from distinct locations. Keep the existing conservative ring
search and distance comparison, including searching further on boundary ties.
For a fixed number of coincident locations, queue traversal across retirement
is linear in entry count after sorting, rather than repeatedly scanning every
live duplicate. General nearest-neighbour search is still distribution-dependent;
this is not a universal linear-time or minimum-travel guarantee.

This changes lookup work only. Every path, pass, point, direction policy,
closed-start policy (ADR-494), containment dependency and process setting stays
owned by the existing planner. Overlap removal remains a separate opt-in feature.
Machine controls, output policy and Frame/Start admission are unchanged.

## Verification

The regression suite compares selected entry identity with an independent
exhaustive oracle, exercises one-ULP coordinate differences, ties and retirement,
and bounds availability checks for 4,096 coincident paths. The work bounds fail
on the original implementation and pass on the repair. The repeated large-path
stress and output/correctness evidence are recorded in
`docs/audits/2026-10-13-machining-stress/fix/`.

These are software checks; controller motion and physical cut quality have not
been qualified by this amendment.
