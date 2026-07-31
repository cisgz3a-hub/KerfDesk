# CNC bit catalog research and model-fit audit

**Date:** 2026-08-01

**Branch:** `codex/cnc-bit-catalog`

**Decision:** ADR-275

## Outcome

The catalog exposes 88 modeled cutter envelopes across 13 families whose gross cutting geometry
fits a current CurveDesk kernel. In a fresh library, 86 offer Add and two are already built in.
Most generic rows are operator-matched nominal envelopes; seven entries are separately labeled as
exact products. Another 72 specialty family entries remain searchable, primary-sourced, and
reference-only, for 160 entries total. They stay nonselectable when CurveDesk lacks representative
geometry, toolpath semantics, controller capability, or another requirement needed to use the
family honestly.

This is broad family coverage, not an inventory of every manufacturer SKU. A generic envelope's
nominal diameter is an operator-match field, not a claim that the linked manufacturer sells that
generated size. A family-reference URL documents the cutter type; it does not verify any generated
diameter, coating, cutting length, shank, center-cut/plunge capability, entry strategy, or automatic
feed. It establishes flute metadata only for explicitly single/double O-flute family identity,
whose evidenced one/two-flute count is used in feed calculations. Exact-product and
representative-product evidence are labeled separately in the UI. The exact Amana O-flute
ball-nose entries establish product identity, ball-nose form, diameter, shank, and upcut direction,
but not a numeric flute count; the catalog therefore stores no `fluteCount` for them.

For this audit, completeness means one searchable entry per materially distinct cutting-envelope
or machine-motion contract found in the reviewed primary sources. Diameter, reach, coating,
manufacturer, material, and product-series variants do not get separate entries unless they change
those semantics. The commercial catalog is open-ended, so this is not a claim that every current or
future manufacturer SKU has been enumerated.

## Model-fit boundary

| Current kernel | Addable families | What the preview/simulator does not prove |
| --- | --- | --- |
| Flat cylinder | square/straight, upcut, downcut, compression, single O-flute up/down/straight, double O-flute, and mortise-bit envelopes | flute shape/count except explicit single/double O identity, helix direction, compression transition, center-cut or plunge capability, cutting length, coating, chip evacuation, wall/floor finish, automatic feeds |
| Full-radius ball | untapered ball-nose, exact Amana O-flute upcut ball-nose products, and bearing-free core-box/round-nose bits | numeric flute count for the Amana O-flute ball products, flute form, taper, partial corner radius, bearing/pilot, shank/neck collision |
| Point cone | nominal 60°, 90°, and 120° V-groove products | a finite or radiused tip, angle tolerance, flute shape, cutting length, shank collision |

Inventables lists nominal 60°/90° geometry and shank/cutting dimensions, but also publishes angle
tolerance and does not establish a controlled zero-flat-tip tolerance. Those entries are therefore
named nominal V-bits using a point-cone model, not physically exact zero-tip cutters.

## Reference-only coverage

The searchable reference catalog keeps these distinct instead of encoding them as generic end
mills:

- finite-tip, tipped-off, tip-radius, pointed, and double-angle engraving cutters;
- parallel square-end/ball-end engraving cutters, multi-axis lens/oval finishers, and high-feed
  form end mills;
- tapered square, tapered ball, tapered corner-radius, bull-nose, bowl/tray, fishtail, chamfer,
  back-chamfer, runner, roughing/chipbreaker, slow-helix, four-plus-flute/high-/variable-helix,
  left-hand/reverse-rotation, honeycomb, foam, and surfacing/flycutting tools;
- dovetail, T-slot, keyhole, keyseat/Woodruff, slotting/slitting saw and arbor systems, rabbeting,
  lollipop, and other undercut tools;
- flush-trim/pattern, edge-bearing roundover, point-cutting/plunge roundover and ovolo, beading,
  cove, ogee, molding, table-edge, and handrail profiles;
- flat-tip ACM/TCM panel-folding V-groove cutters;
- tongue-and-groove, finger/box-joint, glue-joint, lock-miter, drawer-lock, raised-panel,
  stile-and-rail, sash/window, and weatherseal systems;
- twist/spot/brad/V-point, Forstner/hinge, flat-bottom, countersink, counterbore, step/combination,
  combined drill/countersink or drill/counterbore, plug-cutting, spade-drilling, reaming, and
  hole-saw tools;
- drill/end mills, combination drill/thread mills, thread mills, cut taps, and form taps as
  separate operation classes;
- diamond-drag/spring tools, drag/vinyl knives, tangential/oscillating knife systems, rotary
  wheel knives, V-cut/bevel knives, burrs/rasps, fiberglass diamond-pattern cutters,
  abrasive/diamond-grit cutters, and industrial form cutters.

## Primary evidence used

- [LMT Onsrud production cutting-tool catalog](https://www.onsrud.com/images/LMT%20Onsrud%20Product%20Cutting%20Tools%20Catalog%20PCT-19.pdf)
- [Whiteside official cutter collections](https://www.whitesiderouterbits.com/collections)
- [Whiteside left-hand spiral bits](https://www.whitesiderouterbits.com/collections/left-hand-spiral-bits)
- [Whiteside single O-flute straight family table](https://www.whitesiderouterbits.com/products/sa1600)
- [Whiteside mortise bits](https://www.whitesiderouterbits.com/collections/mortise-bits)
- [Amana plastic/O-flute cutter catalog](https://www.amanatool.com/products/router-bits/plastic-cutting-router-bits.html)
- [Amana exact O-flute ball-nose products 51814 and 51818](https://www.amanatool.com/products/cnc-router-bits/plastic-cutting-cnc-router-bits/solid-carbide-spiral-o-flute-ball-nose-plastic-cutting.html)
- [Amana ACM flat-bottom folding V-groove cutters](https://www.amanatool.com/products/cnc-router-bits/aluminum-non-ferrous-metal-cutting-router-bits/double-edge-folding-insert-a-va-groove-with-flat-bottom-router-bits-for-aluminum-composite-material-acm-panels.html)
- [Amana point-cutting roundover cutters](https://www.amanatool.com/products/router-bits/grooving-router-bits/point-cutting-roundover-router-bits.html)
- [Amana plunge roundover cutters](https://www.amanatool.com/products/cnc-router-bits/profiling-cnc-router-bits/plunge-round-over-cnc-router-bits.html)
- [Amana plug cutters](https://www.amanatool.com/products/boring-drilling-bits/plug-cutters/plug-cutters.html)
- [Amana 118-degree CNC spade drills](https://www.amanatool.com/products/boring-drilling-bits/drill-bits-for-non-ferrous-metals-steel-and-wood/solid-carbide-cnc-118-degree-spade-drill-router-bits.html)
- [Amana single O-flute up/down size chart](https://www.amanatool.com/pub/media/productattachments/Aluminum-O-Flute-Speed-Chart-v6.pdf)
- [Amana joinery cutter catalog](https://www.amanatool.com/products/router-bits/jointing-router-bits.html)
- [Inventables 60° V-bit, 1/8-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-60-degree-1-4-in-cutting-x-1-8-in-shank)
- [Inventables 60° V-bit, 1/4-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-60-degree-1-2-in-cutting-x-1-4-in-shank)
- [Inventables 90° V-bit, 1/8-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-4-in-cutting-x-1-8-in-shank)
- [Inventables 90° V-bit, 1/4-inch shank](https://www.inventables.com/products/carbide-tip-v-bit-90-degree-1-2-in-cutting-x-1-4-in-shank)
- [Whiteside 120° V-bit, 1/2-inch shank](https://www.whitesiderouterbits.com/products/1564)
- [Carbide 3D ball-cutter catalog](https://shop.carbide3d.com/collections/cutters/ball-end)
- [Carbide 3D Stingray drag/vinyl knife](https://shop.carbide3d.com/products/stingray-vinyl-cutter)
- [Harvey Tool engraving cutter taxonomy](https://www.harveytool.com/products/specialty-profiles/engraving-cutters)
- [Harvey Tool parallel engraving cutters](https://www.harveytool.com/products/specialty-profiles/engraving-cutters/parallel)
- [Harvey Tool drill/end mills](https://www.harveytool.com/products-en-ca/specialty-profiles/drillend-mills)
- [Harvey Tool combination drill/thread mills](https://www.harveytool.com/products-en-ca/thread-milling-cutters/combination-drillthreadmill)
- [Harvey Tool multi-axis lens/oval finishers](https://www.harveytool.com/products/material-specific-end-mills/aluminum-alloys/multi-axis-finishers)
- [Harvey Tool high-feed form end mills](https://www.harveytool.com/products/high-feed-end-mills-for-high-temp-alloys)
- [Harvey Tool current corner-radius catalog](https://www.harveytool.com/products/material-specific-end-mills/aluminum-alloys/corner-radius)
- [Harvey Tool multi-flute/high-/variable-helix tooling](https://www.harveytool.com/products/featured-solutions/metric-tooling/medium-alloy-steels)
- [Harvey Tool holemaking catalog](https://www.harveytool.com/products/holemaking)
- [Guhring tapping and thread-milling CNC examples](https://guhring.com/media/support/Tapping-Threadmill-CNC-Examples.pdf)
- [ShopSabre tangential oscillating knife system](https://www.shopsabre.com/product/tangential-oscillating-knife-system/)
- [Zund Power Rotary Tool](https://www.zund.com/en/cutting-systems/modules-and-tools/power-rotary-tool-prt)
- [Zund V-cut/bevel knife modules](https://www.zund.com/en/cutting-systems/modules-and-tools)

## Audit defects found and resolved before publish

1. Ball-nose/core-box catalog entries initially appeared in V-carve “Clear floors.” That operation
   emits constant-Z pocket passes, so the selector now admits only flat end mills and has a
   regression test.
2. Family URLs initially looked like exact evidence for every generated size, and generic entries
   carried synthesized flute-count and center-cutting claims into trusted tool metadata. Generic
   rows are now explicitly operator-matched nominal envelopes: non-O-flute rows omit `fluteCount`,
   every generic name omits center-cut/plunge claims, and only explicit single/double O-flute family
   identity retains one/two-flute metadata. Source scope and UI copy distinguish family,
   representative-product, and exact-product evidence and disclaim automatic feeds.
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
8. The shared simulator profile's visual stub uses cutter diameter because simulation does not need
   shank geometry. Stepping it to a different catalog shank without cutting-length or transition
   data can falsely enlarge or neck the cutting tip. For a flat cutter, full-radius ball, or valid
   point V-bit, the selection preview therefore preserves the exact simulator profile and reports
   validated shank diameter as metadata only; an unknown shank is labeled as unknown instead of
   implied to be exact. It refuses to draw a cone for an actual V-bit whose included angle fails the
   shared geometry contract. Because the legacy engraving kind stores no truthful tip profile, it
   also shows a readable no-shape fallback rather than repeating the simulator's flat approximation.
   WebGL/scene initialization failure, a later render exception, or WebGL context loss disposes
   acquired preview resources and transitions to readable fallback copy without affecting selection.
9. Deleting a sole active one-flute custom tool could leave an empty tool table, retain the deleted
   active ID, and keep inherited one-flute provenance even though compilation fell back to the
   built-in tool shape. The shared default list and active bit are now restored atomically, and
   inherited automatic recipes recalculate with the shared default flute assumption.
10. Applying a malformed or legacy profile with same-catalog aliases could discard an active or
    layer-referenced current ID. Profile application now canonicalizes only its incoming aliases,
    maps its requested active ID to the survivor, preserves every existing project tool ID, and
    reserves a later exact-ID profile snapshot before resolving an earlier alias so its metadata
    and automatic-feed identity cannot be lost to entry ordering.
11. Deleting a bit must not silently change an active secondary machining stage. Deletion is now
    refused while an active V-clear, relief-finish, or pocket-roughing stage uses the bit, while
    dormant hidden references are cleared and primary manual selections retain their established
    compile-time fallback policy.
12. Saved machine profiles were previously restored after structural checks only, so malformed
    tool objects and unbounded catalog metadata could bypass the `.lf2` validation contract. The
    local profile parser now reuses the bounded CNC machine normalizer before a profile is stored in
    application state.
13. Older CNC projects with a nonempty tool list did not acquire the two new catalog-backed starter
    V-bits, and a matching project open did not merge the operator's app-level custom-bit library.
    CNC restoration now backfills exactly those two starters and merges saved custom bits while
    preserving project-owned copies, IDs, ordering, metadata, references, and Active selection.
14. A same-ID cutter whose trusted flute count changed was not treated as a changed effective bit,
    so retained manual feeds could miss their advisory. Flute count now participates in cutter
    identity: manual values warn, while inherited material recipes recalculate from the new trusted
    metadata without a warning.
15. After a primary bit was deleted, its intentionally retained legacy `toolId` silently looked like
    an ordinary Active binding. The selector now keeps the missing ID visible as a disabled
    diagnostic, clearing the already-fallback binding is silent, and later Active-bit changes still
    warn for retained manual values or refresh inherited recipe provenance.
16. A malformed or legacy V-clear binding could point at a ball-nose or engraving tool and still
    reach constant-Z clearance compilation. Compilation now emits a V-clear group only for an end
    mill, and preflight refuses the wrong-kind binding only when that active operation would actually
    contribute a clearance path. This is compile-integrity enforcement, not a new ordinary Start
    policy gate.
17. The initial taxonomy collapsed or omitted materially different hybrid holemaking, multi-axis
    form, panel-folding, knife, plunge-profile, engraving, plug-cutting, and spade-drilling
    contracts. The audited expansion adds one searchable reference-only entry for each distinct
    unsupported contract and adds only the two exact Amana O-flute ball-nose products whose gross
    geometry fits the existing full-radius kernel. Their numeric flute count remains unknown.
18. Persisted secondary bindings could still silently change promised output: rest-pocket roughing
    accepted a ball/V/engraving cutter by diameter alone, while missing V-clear and relief-finish
    IDs quietly removed those stages. The shared compile-integrity pass now requires a contributing
    rest rougher to resolve to an end mill and active V-clear/relief-finish IDs to resolve. Direct
    compile remains defensive, and dormant or geometry-inapplicable bindings remain nonblocking.

## Qualification boundary

Automated tests can establish catalog identity, input validation, persistence, selector filtering,
feed-calculation provenance, grouping, and cutting-envelope construction. They do not establish:

- that a nominal template matches a cutter in the operator's hand;
- collet/shank fit, stick-out, runout, balance, cutting length, or machine clearance;
- suitable RPM, feed, chipload, plunge strategy, chip evacuation, or workholding;
- physical V-groove width/depth from a cutter with angle or tip tolerance; or
- surface finish, dimensional accuracy, noise, heat, tool life, or safe operation on hardware.

No spindle was energized, no air cut was run, and no material was cut for this audit.
