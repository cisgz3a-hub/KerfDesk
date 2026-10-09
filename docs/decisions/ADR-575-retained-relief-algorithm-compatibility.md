## ADR-575 - Retained relief algorithm compatibility

**Status:** Implemented under the maintainer's 2026-10-09 PR audit repair request.

**Problem.** PR #1109 changed excluded masks from sample-centre admission to whole-cell
coverage, changed rail profiles from triangle interpolation to bilinear strip inversion,
and changed the evaluation order of sample coordinates. It also increased the cost of
excluded masks. Both earlier and corrected files still said `retained-relief-v1`, so
valid saved projects could fail the exact composition check or the new work estimate.

**Decision.** Preserve the historical `retained-relief-v1` interpreter and its existing
32,000,000 work cap. It uses sample-centre masks, the original triangle interpolation
and admission, and the original coordinate evaluation order. New documents use
`retained-relief-v2`, with whole-cell excluded masks, injective bilinear rail strips,
normalise-first sample coordinates and the corresponding stricter mask cost. The field
storage and authoring schema stay unchanged; unknown algorithm revisions are rejected.

Loading validates every retained source payload, digest, mapping and physical/revision
binding before proving that the saved canonical field matches the retained document.
A v1-labelled document is checked against v1 first. Only if that does not match may a
separately work-admitted v2 composition prove the unversioned #1109 interpretation.
The latter case resolves just the algorithm marker to v2. A per-load map carries that
proof into normalization, keyed by the owning relief object so shared document aliases
cannot transfer an interpretation to another field. No global cache or repeated composition
is needed. The saved
field, its revision, source precision, masks, dimensions and floats are preserved.
Each attempted interpretation retains its own existing resource cap; there is no
unbounded recomposition or blanket increase of the work limit. If neither field matches,
the document is rejected. A labelled v2 document never falls back to v1.
If both interpretations produce the same field, the unversioned file cannot
identify which implementation wrote it; v1 wins deterministically until an explicit edit.

Opening, cancelling the editor, automatic linked refresh and Undo preserve the saved
interpretation. The explicit relief editor discloses that editing a legacy relief
applies corrected edges and rail profiles, then validates and composes the candidate
as v2 before committing it atomically. An over-budget or non-injective candidate leaves
the original document and canonical field intact. Archived project strings remain
intact and resolve their interpretation when opened through the same project loader.

CAM continues to consume only the saved materialized U16 field. This decision adds no
Frame, Start, output or licence gate and establishes no physical-machine qualification.

**Verification.** Frozen parent-of-#1109 project files cover excluded edges, a 512 × 512
clipped import, varying rail profiles, legacy triangle admission and coordinate-rounding
changes. Persistence tests preserve fields through reopening and reject stale fields,
unknown revisions and v2-to-v1 fallback. Editor tests cover explicit conversion, Undo
and atomic rejection; current mask and bilinear correctness tests remain in force.
