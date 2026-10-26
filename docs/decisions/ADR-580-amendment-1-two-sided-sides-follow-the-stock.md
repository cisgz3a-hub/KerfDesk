## ADR-580 Amendment 1 - A two-sided split follows the stock thickness (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

This amends ADR-580 Decision 4 (splitting an STL relief for two-sided carving). It fixes CNC audit
v1 finding F6-P1-1 (`docs/audits/2026-10-23-cnc-v1/F6-cnc-relief-3d.md`), which the refuter and
the coordinator confirmed as P1. No Frame, Start, output or licence gate is added or removed
(ADR-228, ADR-565); every new disclosure is a Job Review advisory or a panel note.

### Context

The split planned both sides for the stock thickness in Machine Setup at that moment. It placed
each side's stock-face frame at that thickness, and relief CAM maps a relief's highest point, the
frame, to Z0. Nothing recorded that thickness and nothing checked it again. A stock edit after
the split therefore left both programs as they were, and the halves no longer met:

- split on 14 mm, then 18 mm stock: the part came out 4 mm too thick, with a 5 mm web;
- split on 14 mm, then 12.5 mm stock: the part came out 1.5 mm too thin, and the floors crossed
  by 0.5 mm, so the part was cut free during side B;
- split on the default 6.35 mm stock, which the split planned as stock as thick as the 10 mm
  model, then the real 14 mm board: 4 mm too thick.

The STL import notice and the split's thin-stock toast both invite exactly that stock edit. Save and
reload kept the stale programs, and no check, Job Review note or panel said anything. Vectric's
Material Setup keeps one position of the model in the material, shared by both sides, and derives
both sides from the current material thickness
(https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/form/material-setup-flat).

### Decision

1. **Each side records its plan.** The split stores `twoSidedSplit` on both side reliefs: which
   side it is, the stock thickness its frame was planned for (the model's height when the stock
   was thinner), the model's height, the split height and the holding web. Projects save and load
   it, and a malformed record is refused on load.
2. **Relief CAM follows the current stock.** Wherever a program is prepared (Save, Start, Preview,
   the estimate, Frame's footprint and the G-code Inspector's design), each recorded side is
   re-planned for the current stock thickness T′. Both stock faces move by (T′ − T)/2. The model
   and each side's floor stay put, so the model stays centred and side A cuts (T′ + D)/2 − split
   while side B cuts (T′ − D)/2 + split − web. Together they cut T′ − web, so the floors stay the
   split's web apart for any stock. With the stock unchanged, the side is used exactly as stored.
   The re-planned side is the side a split on T′ gives, so a stock edit needs no re-split.
3. **Stock thinner than the model caps it.** The programs cap the model at both stock faces
   instead of planning for stock as thick as the model. The part comes out as thick as the stock
   and the web still holds it. Job Review says so for the active side. The stored sides stay
   uncapped (planned for the model's height, as before), so a thicker board entered later gets
   the whole model back.
4. **The web stays inside the stock.** On stock thinner than the model, the split plane or the
   web can fall outside the stock. A side's floor would then cut through the far face. Instead,
   the split moves just far enough to keep the web inside the stock: up to the bottom face plus
   the web, or down to the top face. The side whose share lies outside the stock has nothing to
   carve, so its relief drops out of its program and Job Review says why. A side's floor only
   ever rises in its own frame, so the stored mesh always has the model the new floor needs. The
   two floors are never planned closer than the web.
5. **Older splits are named.** A side split before this amendment carries no record and cannot
   follow the stock. Job Review warns about it on the active side (recognised by the split's
   "(side A, top)" / "(side B, bottom)" name) and asks for a re-split for the new stock if the
   thickness changed after the split. A recorded side whose depth was rescaled after the split no
   longer matches any stock; it is carved as stored, and Job Review asks for a re-split.
6. **The panel tells the truth.** A side relief's **Two-sided carving** section no longer offers a
   second split. It says which side it is, that both sides follow Machine Setup › Stock, and the
   stock they are centred in now. The split's toast and note say the sides follow a later stock
   change, and the thin-stock toast asks for the board's real thickness.

### Consequences

- A stock edit after a split changes both side programs to match the new stock, and the Inspector's
  design compare does the same.
- The model is capped only when the stock is thinner than the model: the frame moves and the model
  is laid flat at the face, which is the surface min(model, face) that CAM reads.
- Re-planning copies a side's mesh once per stock thickness and keeps the copy for that relief, so
  Preview and estimates do not redo it.
- Side reliefs from before this amendment keep their old programs. The advisory names them, but
  only a re-split, or an undo back past the split, gives them a record.
- Simulated and compiled evidence only. No air cut, material or hardware result is claimed.

### Verification

- `relief-two-sided-stock.test.ts`: a sphere's sides split on one stock and refit for another
  (thicker, thinner but above the model, and planned on stock thinner than the model, then the
  real board) read the same as a split on that stock. Their depths sum to T′ − web. Stock thinner
  than the model caps the pole at both faces and keeps the web. Stock wholly under a high split,
  or over a low one, keeps the web inside the stock and drops the other side. For splits of 3, 10
  and 16 mm and stocks from 1.5 to 40 mm, the floors are never closer than the web. An unchanged
  stock keeps the stored relief; a mesh without its frame, or a rescaled side, is reported.
- `prepare-output-two-sided-relief.test.ts` runs the real split action (a 5.3 mm split, which is
  not a binary fraction), Machine Setup's stock edit and `emitGcode`. The 14 → 18, 14 → 12.5 and
  6.35 → 14 programs equal the programs of a split on the new stock, and their deepest cuts leave
  the 1 mm web. Unchanged 14 mm stock cuts 6.7 and 6.3 mm. 8 mm stock keeps the web. Save and
  reload keep the record and the programs. With the refit disabled, the four stock-edit tests fail.
- `relief-two-sided-actions.test.ts`, `cnc-two-sided-stock-warnings.test.ts`,
  `inspection-design-two-sided.test.ts`, `ReliefTwoSidedSplit.test.tsx`: the record on both sides,
  the model's height recorded for thin stock, a second split refused, the three advisories, the
  Inspector's design for a new stock, and the side's panel note.
- Independent check: the audit's two-sided stock simulation (`f6-two-sided.mjs`, no app code)
  stamped programs this build emitted for the audit's wedge (a 5 mm split, 1 mm web). Split on
  14 mm then 18 mm, on 14 then 12.5, and on 6.35 then 14 now measure as the unchanged 14 mm
  control does. The part thickness error is p50 0.022–0.023 mm and max 0.099 mm (the audit
  measured +4.02, −1.48 and +4.01 mm). The web in the margin is 1.12–1.38 mm (it was 5.1, −0.38
  and 5.1 mm).
