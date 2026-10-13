## ADR-594 - Draggable frame and cutting starts

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-13. Software verification does not establish hardware qualification.

**Context.** Permanent Frame start and Job start labels obscured nearby artwork. The maintainer requested compact, draggable markers whose selections control actual output, survive project saves, and can become defaults for future jobs. Job start means the first cutting point, without moving the artwork's placement.

**Decision.** The canvas uses small frame and cutting handles, with labels on hover, focus and dragging. A frame selection snaps to the prepared motion envelope's perimeter; the displayed and dispatched frame share the same closed route and chosen entry. A cutting selection snaps to supported geometry in the first executable operation, preserving operation order, inside-first dependencies and the configured direction policy. Closed polylines can start along an edge; native arcs snap to existing move boundaries to preserve their exact geometry. Open paths offer their permitted endpoints.

Raster and fill retain generated scan order. CNC selection supports identical closed contour depth passes; ramps, entry plunges, stay-down entries and other generated sequences retain their existing entry. Both handles are unavailable for registered Print and Cut and rotary views. Side B retains the cutting start chosen on source artwork; its job handle and default saving are unavailable. Busy-machine or document changes cancel a drag before it can commit. Escape, pointer cancellation and lost capture discard it.

Optional `Project.startPoints` stores the frame edge/fraction and cutting point in scene millimetres. One completed drag creates one undoable, dirty project edit. Each start can reset to automatic. Malformed optional fields are normalised on Open; Save refuses a semantic change introduced by validation. Missing fields preserve legacy automatic behaviour.

**Use as defaults for new jobs** stores preferences locally on this device. Frame defaults retain their edge/fraction; cutting defaults retain proportions within output bounds, so differently sized artwork resolves to its own valid cutting point. Defaults apply only to a fresh blank launch and New, never to an opened or restored document. Clearing defaults affects future jobs. Storage failures are reported.

**Frame policy.** ADR-565 remains the governing spatial-evidence contract. Selected starts participate in spatial identity, so changing either requires a fresh Frame. Ordinary power and speed edits continue to retain evidence when the spatial inputs and resolved footprint remain unchanged. Each Start still reviews and claims the current exact executable program. No new entitlement or machine-policy gate is introduced.

**Verification.** Regression coverage checks project/default persistence, Undo, native and relative coordinate mapping, frame perimeter and emitted cutting-start agreement, arc preservation, unsupported entries, stale/busy drag cancellation and Frame identity. This decision does not claim air-cut, material or physical-machine qualification.
