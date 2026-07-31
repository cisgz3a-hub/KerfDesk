# CNC bit catalog research and model-fit audit

**Date:** 2026-08-01

**Branch:** `codex/cnc-bit-catalog`

**Decision:** ADR-273

## Outcome

The catalog exposes 86 modeled generic nominal templates across 12 cutter families whose gross
cutting envelope fits a current CurveDesk kernel. In a fresh library, 84 offer Add and two are
already built in. Another 55 specialty family entries remain searchable and source-backed but
reference-only. They stay nonselectable when CurveDesk lacks either representative geometry and
toolpath semantics or sufficiently verified dimensions and capability constraints.

This is broad family coverage, not an inventory of every manufacturer SKU. A family-reference URL
documents the cutter type; it does not prove that every generated diameter, flute count, coating,
cutting length, or shank combination exists in that manufacturer's range. Exact-product and
representative-product evidence are labeled separately in the UI.

## Model-fit boundary

| Current kernel | Addable families | What the preview/simulator does not prove |
| --- | --- | --- |
| Flat cylinder | square/straight, upcut, downcut, compression, single O-flute up/down/straight, double O-flute, and center-cutting mortise bits | flute shape, helix direction, compression transition, center-cut geometry, cutting length, coating, chip evacuation, wall/floor finish |
| Full-radius ball | untapered ball-nose and bearing-free core-box/round-nose bits | flutes, taper, partial corner radius, bearing/pilot, shank/neck collision |
| Point cone | nominal 60°, 90°, and 120° V-groove products | a finite or radiused tip, angle tolerance, flute shape, cutting length, shank collision |

Inventables lists nominal 60°/90° geometry and shank/cutting dimensions, but also publishes angle
tolerance and does not establish a controlled zero-flat-tip tolerance. Those entries are therefore
named nominal V-bits using a point-cone model, not physically exact zero-tip cutters.

## Reference-only coverage

The searchable reference catalog keeps these distinct instead of encoding them as generic end
mills:

- finite-tip, tipped-off, tip-radius, pointed, and double-angle engraving cutters;
- tapered square, tapered ball, tapered corner-radius, bull-nose, bowl/tray, fishtail, chamfer,
  back-chamfer, runner, roughing/chipbreaker, slow-helix, and surfacing/flycutting tools;
- dovetail, T-slot, keyhole, keyseat/Woodruff, slotting/slitting, rabbeting, lollipop, and other
  undercut tools;
- flush-trim/pattern, roundover, beading, cove, ogee, molding, table-edge, and handrail profiles;
- tongue-and-groove, finger/box-joint, glue-joint, lock-miter, drawer-lock, raised-panel,
  stile-and-rail, sash/window, and weatherseal systems;
- twist/spot/brad/V-point, Forstner/hinge, flat-bottom, countersink, counterbore, step/combination,
  reaming, and hole-saw tools;
- thread mills, cut taps, and form taps as separate operation classes;
- diamond-drag/spring tools, rotary burrs/rasps, fiberglass diamond-pattern cutters,
  abrasive/diamond-grit cutters, saw/arbor systems, and industrial form cutters.

## Primary evidence used

- [LMT Onsrud production cutting-tool catalog](https://www.onsrud.com/images/LMT%20Onsrud%20Product%20Cutting%20Tools%20Catalog%20PCT-19.pdf)
- [Whiteside official cutter collections](https://www.whitesiderouterbits.com/collections)
- [Whiteside O-flute straight bits](https://www.whitesiderouterbits.com/collections/o-flute-straight-bits)
- [Whiteside mortise bits](https://www.whitesiderouterbits.com/collections/mortise-bits)
- [Amana plastic/O-flute cutter catalog](https://www.amanatool.com/products/router-bits/plastic-cutting-router-bits.html)
- [Amana joinery cutter catalog](https://www.amanatool.com/products/router-bits/jointing-router-bits.html)
- [Inventables 90° V-bit, 1/8-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-4-in-cutting-x-1-8-in-shank)
- [Inventables 90° V-bit, 1/4-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-2-in-cutting-x-1-4-in-shank)
- [Carbide 3D ball-cutter catalog](https://shop.carbide3d.com/collections/cutters/ball-end)
- [Harvey Tool engraving cutter taxonomy](https://www.harveytool.com/products/specialty-profiles/engraving-cutters)
- [Harvey Tool current corner-radius catalog](https://www.harveytool.com/products/material-specific-end-mills/aluminum-alloys/corner-radius)
- [Harvey Tool holemaking catalog](https://www.harveytool.com/products/holemaking)
- [Guhring tapping and thread-milling CNC examples](https://guhring.com/media/support/Tapping-Threadmill-CNC-Examples.pdf)

## Audit defects found and resolved before publish

1. Ball-nose/core-box catalog entries initially appeared in V-carve “Clear floors.” That operation
   emits constant-Z pocket passes, so the selector now admits only flat end mills and has a
   regression test.
2. Family URLs initially looked like exact evidence for every generated size. Source scope and UI
   copy now call them generic nominal templates and distinguish family, representative-product,
   and exact-product evidence.
3. Ordinary external anchors are denied by the packaged Electron navigation policy. Source URLs
   are now shown as selectable text rather than presenting a dead link.
4. A catalog ID imported in another operator's `.lf2` could be mistaken for an app-saved bit. UI
   availability now comes from the local custom library; saving adopts the imported ID and replaces
   its metadata from the trusted catalog without adding a duplicate. When adoption changes the
   active copy's trusted flute count, inherited automatic recipes also refresh from that metadata.
   Built-in V-bits remain non-deletable and are labeled Built in.
5. Persisted family strings such as `constructor` could reach inherited object properties in the
   grouping lookup. The lookup now uses an own-key `Map`, and hostile prototype-key coverage was
   added.
6. Switching or applying a profile that activates a single O-flute tool could retain a two-flute
   material recipe. Effective active-tool changes now recalculate inherited automatic recipes with
   the new catalog flute count while preserving explicit counts for layers pinned to another tool.
7. Project and local-library deserializers previously stripped every new metadata field. Both now
   retain only bounded, validated family, shank, flute, and catalog identity values.
8. Deleting a sole active one-flute custom tool could leave an empty tool table, retain the deleted
   active ID, and keep inherited one-flute provenance even though compilation fell back to the
   built-in tool shape. The shared default list and active bit are now restored atomically, and
   inherited automatic recipes recalculate with the shared default flute assumption.
9. Applying a malformed or legacy profile with same-catalog aliases could discard an active or
   layer-referenced current ID. Profile application now canonicalizes only its incoming aliases,
   maps its requested active ID to the survivor, preserves every existing project tool ID, and
   reserves a later exact-ID profile snapshot before resolving an earlier alias so its metadata
   and automatic-feed identity cannot be lost to entry ordering.
10. Deleting a bit must not silently change an active secondary machining stage. Deletion is now
    refused while an active V-clear, relief-finish, or pocket-roughing stage uses the bit, while
    dormant hidden references are cleared and primary manual selections retain their established
    compile-time fallback policy.
11. Saved machine profiles were previously restored after structural checks only, so malformed
    tool objects and unbounded catalog metadata could bypass the `.lf2` validation contract. The
    local profile parser now reuses the bounded CNC machine normalizer before a profile is stored in
    application state.

## Qualification boundary

Automated tests can establish catalog identity, input validation, persistence, selector filtering,
feed-calculation provenance, grouping, and cutting-envelope construction. They do not establish:

- that a nominal template matches a cutter in the operator's hand;
- collet/shank fit, stick-out, runout, balance, cutting length, or machine clearance;
- suitable RPM, feed, chipload, plunge strategy, chip evacuation, or workholding;
- physical V-groove width/depth from a cutter with angle or tip tolerance; or
- surface finish, dimensional accuracy, noise, heat, tool life, or safe operation on hardware.

No spindle was energized, no air cut was run, and no material was cut for this audit.
