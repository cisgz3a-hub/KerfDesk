## ADR-481 - The CNC Artwork settings show what the cut needs, and Machine Setup holds the machine (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Maintainer direction, 2026-09-26, about the Artwork panel's Settings tab: "this whole section
becomes weird and cluttered and non understandable. We should be at easy to navigate understand
and use. remove settings or stuff that shouldn't be there. make sure first". ADR-430 did the laser
half; this is the CNC half, and it follows on 2026-09-27 ("continue").

This amends ADR-306 (its 2026-09-22 amendment and decisions 3 and 4) for the CNC inspector. Machine
maximum stays next to the requested spindle speed, but as a link under it rather than a
read-only reference row, and the stock and machine references leave Artwork settings. Settings
storage, operation and override rules, Machine Setup's draft boundary and compiled output do not
change. No new guard is added (ADR-228).

### Context

For one selected square, the CNC Settings tab stacked three full-width dropdowns (Material, Bit,
Cut type), Cut depth, a feed grid with Plunge alone on a row, a grey "Machine maximum 12,000 RPM"
bar above Artwork spindle speed, an "About feeds" disclosure, and then eight disclosures in two
visual styles: Cut options, Bit details & additional tools, Holding tabs, Entry & travel, Saved
feeds, Feeds calculator and Stock & machine reference. Opened, Bit details alone held a paragraph,
the bit's name and picture, the second-bit choosers, and an **Add another bit** library with a
long catalog disclaimer, 96 families and their raw PDF links, and a custom-bit form. Several
sections opened with a paragraph repeating their tooltip. Messages pointed at "Tool & material",
a name the panel never showed.

Every control was checked for a home before anything left the inspector:

| Left the inspector | Where it is now |
|---|---|
| Add another bit (catalog, custom bit) | Machine Setup → Bit library, opened by **Manage bits** beside Bit |
| Bit picture and name | Machine Setup bit library and default bit; the name is in the Bit tooltip |
| Stock & machine reference (stock, tiling, spin-up, coolant, safe Z, park) | Machine Setup, which already owns and edits them |
| Machine maximum reference row | "Max 12,000" link under Spindle speed, opening that Machine Setup field |
| Cut options: cut-type explanation | The Cut type tooltip |
| Cut options: Traced edges | Under Cut type, only when the operation cuts imported or traced outlines |
| Cut options: Set to stock thickness | A link under Cut depth |
| Bit details: Floor clearing, Pocket roughing, Relief finishing bit | Under Bit, only while the cut type uses it |
| About feeds, section paragraphs, the tab-count note, the plain V-carve note | The tooltips of the fields they explain |

### Decision

1. **Cut type** leads the CNC fields, with its one-line explanation as its tooltip. **Traced
   edges** follows only for outline and engrave operations that cut imported or traced outlines,
   the only artwork it can change (ADR-218, ADR-277).
2. **Bit** follows with a quiet **Manage bits** link that opens the Machine Setup bit library
   (`bit-library` field). The second bit the cut type uses appears under it only while it applies:
   **Pocket roughing bit** (non-adaptive pocket), **Floor clearing bit** (flat-floor V-carve) or
   **Relief finishing bit** (relief). Bindings the current cut type does not use are kept.
   When composed with ADR-457, the bit hint distinguishes inherited operation values from a
   matching cutter's separate recipe and points to **Stage cutting values**. Changing the
   material or temporarily choosing another cutter keeps saved independent recipes.
3. **Material** follows; its tooltip says that choosing one applies starting values and a new
   bit refreshes them.
4. Cut depth (Floor depth for a flat V-carve, Insert depth for an inlay pair) and Depth per pass
   share one row, with **Set to stock thickness** under it. A V-carve asks **Flat floor** first.
5. Feed, Plunge and **Spindle speed** share the next row, like the laser Power, Speed and Passes.
   The machine maximum ("Max 12,000") sits directly under Spindle speed and opens its Machine
   Setup field. Its accessible name still starts "Machine maximum:". In a panel narrower than
   about 290 px a third of the row cannot show five digits beside the number arrows, so Spindle
   speed takes its own row there, with the maximum still under it.
6. The V-carve cutter warning shows right after Bit and Material, not inside a section.
7. The remaining sections appear only for the cut types they serve and name their state when
   closed: Holding tabs ("4 per shape" or "Off"), Clearing strategy ("Offset · 40 %"), Inlay fit,
   Wall finish, Relief finish, V-carve detail ("Automatic"), Entry & travel ("Climb · Plunge"),
   Stage cutting values (ADR-457), Saved feeds ("2 saved") and Feeds calculator (its material,
   or "Needs a material"). Entry names **Circular ramp** when enabled; the Wall finish tooltip
   distinguishes a separate finish recipe from the inherited single full-depth finish. Their
   explanations are the summary tooltips, not opening paragraphs. Folding a section keeps its
   inputs mounted.
8. Messages that pointed at "Tool & material" now name the control ("choose one under Bit above",
   "Single bit under Pocket roughing bit above").

### Consequences

- `CncSetupReferenceFields` and `CncOperationBitLibrary` are removed. `SetupOwnedValueRow` stays
  for the Design Studio.
- Tests, tutorials and WORKFLOW say **Spindle speed**, **Bit**, **Material** and **Manage bits**.
- Machine Setup gains a `bit-library` field anchor; its bit library is unchanged.

### Amendment 2 — Show omitted open CNC contours (2026-10-07)

A closed-only CNC operation can contain both a valid pocket boundary and open
lettering. The pocket still cuts, so the all-open note and empty-layer diagnostic
alone do not explain the omitted lettering.

The compiler records exact open-contour counts and separate source-object IDs
from the canonical contours it already collected for each operation. Pocket,
V-carve and Drill report these omissions; open-capable profiles and Engrave do
not. Closure follows the collected canonical geometry, including V-carve stroke
outlines, rather than compatibility flags or whether a closed contour happens to
produce a toolpath. Fresh jobs retain authoritative empty arrays too.

Artwork settings show the omitted count on mixed operations and retain the
all-open no-toolpath explanation for vector-only operations. An assigned relief
can contribute motion independently of the vector cut type, so that case reports
only the omitted vector contours without claiming the whole operation is empty.
This note uses assignment facts and does not compile relief output in the live
inspector. Output-off operations remain quiet. Job Review
shows the count as an advisory even when qualification uses only retained compile
evidence. It never disables ordinary Start or Save G-code, and the valid toolpath
and emitted bytes do not change.

For fresh prepared jobs, **Show omitted artwork** cancels the pending review,
selects unchanged eligible omitted objects without expanding their canvas groups,
fits the selection and opens Artwork. Correspondence belongs to the actual
prepared project and output scope. Content fingerprints reject changed or
reused-ID artwork; current operation, output, visibility and machine eligibility
are checked before navigation. Preparing or blocked reviews cannot navigate.

Archived jobs retain recorded counts but offer no fabricated correspondence to
today's canvas. Derived CNC recovery jobs retain both optional omission arrays
only for layers that still contain CNC motion. Legacy artifacts without these
arrays do not reconstruct historical omissions from current artwork.
