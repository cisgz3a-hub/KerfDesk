# LightBurn Extend investigation

Date: 2026-10-11. Scope: drawing and editing only. The maintainer requested a
LightBurn Extend investigation, an interaction brief, an interactive KerfDesk
preview, and an independently implemented feature. The resulting product contract
is [ADR-586](../decisions/ADR-586-extend-open-path-endpoints.md).

## Evidence boundary

REA 6.4.0 with Ghidra 12.1.4 analysed the installed Windows x64 executable at
`C:\Program Files\LightBurn\LightBurn.exe`, identified locally as LightBurn 2.1.02.
The evidence subject SHA-256 is
`a0836cc167ff4402e68d35ef3384a2042c4ddb7aa83a428fb754371f4290b0c6`.
The private imported snapshot was analysed statically. No LightBurn editing
scenario or hardware operation was executed to establish these findings.

The adjacent installed PDB was not imported. REA's current public Ghidra
configuration exposes neither a PDB path nor an arbitrary pre-script. Symbol
names, several argument signatures, object flags and structure meanings therefore
remain partly inferred. Ghidra pseudocode is analysis evidence, not original
source. In particular, helper signatures may omit output parameters; uninitialised
locals in a caller are not by themselves proof of a LightBurn defect.

Raw records are retained outside this repository under
`C:\Users\Asus\Tools\rea-install-verification\lightburn-extend`. No proprietary
decompiled implementation or LightBurn asset is incorporated into KerfDesk.

## Documentation baseline

The [current Edit Nodes guide](https://docs.lightburnsoftware.com/latest/Reference/EditNodes/)
documents hovering an open endpoint and pressing E to extend to the nearest
intersecting path. It requires editable, ungrouped paths, with primary shapes,
text and barcodes converted first. The
[legacy guide](https://docs.lightburnsoftware.com/legacy/Tools/EditNodes)
describes extending from the hovered point to an intersection with another shape.
Neither page establishes curve-continuation mathematics, numerical tolerances,
same-contour hits, target visibility filtering, or no-hit feedback.

## Static findings

### Input selection and command grouping

Observed in E-key branch `0x45` of `0x140376750` (E06): the handler searches near
the pointer, checks distance and a result flag, then calls `0x140379a80` to
collect edit commands. It creates an **Extend Path** command group only when the
collection is nonempty.

The picker at `0x140359bd0` (E11) compares squared distances after transforming
coordinates. It labels ordinary vertices with flag 7 and the two curve handles
with flags 2 and 4. The E handler's bit-zero test therefore distinguishes vertices
from handles; it is not itself an open-end test. `0x140302c90` (E08) separately
examines segment connectivity, supplies a segment index and can reject a closed
chain. Interpreting that helper as source-end eligibility is strongly supported
by this topology and its use immediately before extension.

When a node is not sufficiently close, E06 also calls a segment picker. For its
returned scalar in `[0, 0.7)`, the handler attempts the first vertex; for a value
in `(0.3, 1]`, it attempts the second. Both calls can occur in the middle interval.
E13 confirms the segment-picking wrapper traverses a candidate collection,
applies object-type/flag checks and delegates to a geometry picker. The exact
meaning of the returned scalar still depends on that lower helper. The installed
implementation must not be described as accepting only directly hovered endpoints.

### Direction and contact choice

E07 handles segment tags 0 and 1. Tag 0 uses the two endpoint coordinates. Tag 1
uses the requested endpoint and its adjacent stored control coordinates. The
helper constructs a temporary directed segment using a normalised direction
scaled by 10,000 before applying the source transform. This supports a finite
source-coordinate search construction, not an established 10,000 mm world-space
limit: nonuniform scale and the downstream intersection contract matter.

After gathering contacts, E07 selects the smallest returned parameter strictly
greater than approximately `1e-5`. This supports nearest-positive-contact
behaviour. That constant is a parameter threshold, not a demonstrated
`0.00001 mm` geometry tolerance. Its distance interpretation depends on how the
intersection helper parameterises the temporary segment.

E09 constructs transformed line or four-point curve geometry and bounds before
calling E10. E10 contains line/line and line/curve branches, recursive handling
of one aggregate object type, and tolerance-aware endpoint handling. No blanket
rejection of closed target contours is visible. The four-point/control data
supports interpreting tag 1 as cubic geometry; object-type names are still
inferred without symbols. Full target eligibility, exact tolerance semantics,
and all degenerate cases are not established by this trace.

E12 examines whether the candidate belongs to the original source geometry and
compares the participating segment vertex indices. For shared vertices it invokes
a point-comparison helper near the corresponding endpoint. This supports selective
rejection of shared-end contacts, not blanket exclusion of every segment belonging
to the source. The comparison helper's tolerance and the behaviour of distant
self-intersections remain unverified.

### Source mutation and curves

For tag 0, E07 queues replacement coordinates for the chosen existing vertex
while carrying its auxiliary fields. This supports moving a straight terminal
endpoint without replacing the remaining path.

For tag 1, it obtains a clone, creates a new vertex at the accepted contact and
inserts a tag-0 segment, then queues object replacement and selection-related
commands. Together with the endpoint/control direction calculation, this is
strong static evidence for **adding a straight tangent continuation to a cubic
end while retaining the existing curve**, rather than extrapolating the cubic
polynomial or simply dragging its endpoint.

These mutation interpretations have not been corroborated with before/after
LightBurn project files or UI interaction.

### No accepted contact

Observed: geometry commands are appended only after an accepted positive contact;
E06 does not open its undo group for an empty command list. The supported
interpretation is no queued Extend geometry edit or Extend undo entry on no hit.
It is not established that the UI is silent: E07 invokes another helper with
argument `0x3e9` on some completion paths, and that helper's meaning is unresolved.

## Evidence ledger

All eight records have the executable identity above. IDs identify retained REA
evidence, not source-code symbols or runtime events.

| Key | Record | Procedure | Evidence ID | Bounded use |
| --- | --- | --- | --- | --- |
| E06 | `06-procedure_pseudo_code.json` | `0x140376750` | `ev_e943f2dfdad265052c3d0e3c01f51b8525e272169b16d62e6d7dd1a73019efa7` | E-key dispatch, endpoint/segment requests, nonempty command grouping |
| E07 | `07-procedure_pseudo_code.json` | `0x140379a80` | `ev_34fd12758a78654fce708e121b39706cc1d0866bd8d9b86942d1b033f0ecfeba` | Direction construction, positive contact selection, separate source mutation branches |
| E08 | `08-procedure_pseudo_code.json` | `0x140302c90` | `ev_9aebae1f9631f705184e66a80adf32831865e6a7787326c3b65a0b33ae4444ae` | Source connectivity and segment eligibility |
| E09 | `09-procedure_pseudo_code.json` | `0x1401be560` | `ev_d50b5b37c73bc61d372f1cc94086678e058cac6fc9277212723cebbc8b612590` | Transformed line/curve setup and intersection dispatch |
| E10 | `10-procedure_pseudo_code.json` | `0x1401be8e0` | `ev_adb5213368b3552a3cd03fa5ebee71a8c5af45f33eb9cbc93ae48874f848a67c` | Geometry pair branches, aggregate recursion, endpoint tolerance paths |
| E11 | `11-procedure_pseudo_code.json` | `0x140359bd0` | `ev_dbe4d0f3f5244f354b1db9d982fcaebf3427d144a637f7235092a027b8ccbb7c` | Vertex-versus-control-handle picking flags |
| E12 | `12-procedure_pseudo_code.json` | `0x1401aad20` | `ev_24b7964eebeca97a5724968d66642debcebfaaabe974ba0ae7ece1b69c2beec8` | Source identity, adjacent vertex indices and shared-end rejection |
| E13 | `13-procedure_pseudo_code.json` | `0x1403754d0` | `ev_ea38912ed5a638af8cd97fa4bc6128018e444a7426b04720110bdd48d4320046` | Segment-picking candidate traversal and lower-helper delegation |

## Independent KerfDesk design

KerfDesk uses original implementation and its existing scene/sketch abstractions.
The geometry is independently derived: world-space ray/segment intersections,
polynomial roots for cubic boundaries, and analytic ellipse/arc contacts. No
decompiled code, proprietary control flow or binary-derived source is copied.

The proposed interaction is deliberately explicit: choose Extend, hover an open
endpoint, inspect the dashed addition and destination, then click to commit one
undoable edit. Straight source ends extend in their existing direction. Curve
ends use a straight tangent addition that preserves the original curve. This is
a product contract informed by observed behaviour, not a complete parity claim.
The maintained ADR defines supported source types for each editor surface and
the handling of hidden, locked, compound and parametric artwork.

KerfDesk explicitly specifies no-hit feedback, already-touching and overlapping
boundary behaviour, source-contour exclusion, immutable boundaries and history.
It does not reproduce LightBurn's undocumented middle-of-segment dual-end
selection or assume its search-length and tolerance constants are desirable.
The standalone preview bundles KerfDesk's actual query/edit functions, so its
geometry demonstrates the implementation rather than a separately simulated
intersection algorithm. Its surrounding layout is an interaction concept.

## Remaining unknowns

- Exact LightBurn target filtering for hidden, locked, grouped and same-object
  geometry. E10 and E12 have same-segment/adjacency checks, but these do not settle
  all original-source self-intersection behaviour or establish the candidate
  collection's relation to visible and selected objects.
- Full intersection-helper precision, tangency, collinear overlap and
  near-zero-distance semantics, including zero-length tangent handling.
- The segment picker's scalar meaning, draw-order tie breaking and all pointer
  threshold units.
- The meaning of completion helper `0x140029480(0x3e9)` and any user notification.
- Runtime confirmation of curve preservation, generated topology, selection and
  undo behaviour in the installed LightBurn build.

KerfDesk tests and browser verification establish its own software behaviour.
They do not qualify LightBurn runtime behaviour, laser output or physical hardware.

## Local verification

Focused checks passed for analytic contacts, both source endpoints, cubic and arc
tangent additions, transformed geometry, scaled tiny handles, stale previews,
metadata preservation, no-op history, Undo/Redo, workspace pointer/menu integration,
and Design Studio's 2D/3D preview and Apply flow. The real workspace browser test
passed on a warmed server after the initial cold-start timeout.

The standalone preview bundles the actual workspace query/edit functions. Edge
verification passed all four scenarios, curve preservation, click/Undo/Redo, mobile
layout and browser-error checks. Final desktop bundling passed; Vite reports
circular-chunk and large-chunk warnings. This is a local bundle, not a packaged
installer or published release.

REA closed the binary successfully. Its private Ghidra runtime directory was
removed, and the installed LightBurn executable still has the recorded SHA-256.
