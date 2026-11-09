## ADR-307 Amendment 5 - DXF and HPGL imports keep to the coordinate limit, and a refused Save names the object (2026-11-09)

**Status:** Accepted. | **Date:** 2026-11-09

This extends Amendment 2 (a LightBurn project that could never be saved is refused at open) to the
project loader's coordinate limit, `MAX_PROJECT_COORDINATE_MAGNITUDE_MM` (1,000,000 mm,
`src/io/project/project-shape-primitives.ts`). It changes import, Save, autosave and the Save
recovery copy only. No G-code, Frame, Start or controller behaviour changes.

### Context

Rolling audit v11, W5-P2-1 (DXF) and W5-P2-2 (HPGL, found by the refuter), both P2:

- The DXF importer checked each entity's own coordinates against ±1,000,000 mm
  (`hasUnreadableGeometry`, `dxf-entities.ts`). It then moved the drawing's corner to 0
  (`normalizeAndGroup`, `dxf-result.ts`), so the stored coordinates were as large as the whole
  drawing's extent. INSERT placement and SPLINE evaluation (weights ≤ 0) were never checked.
- HPGL checked only that coordinates were finite (`hpgl-result.ts`).
- So two LINEs at X −900,000 and +900,000, a part plus one stray entity at X 999,000, a metres site
  plan, an INSERT at X 2,000,000, a negative-weight SPLINE, or a plot with strokes 1,025 m apart all
  imported with no note. Save then failed with ``missing or invalid `scene.objects[1].bounds.maxX` ``,
  autosave failed with "image-heavy projects can exceed browser storage", and the raw recovery copy
  Save offered was refused on reopen for the same field.
- The SVG importer (`svg-import-budget.ts`) and the LightBurn importer (`lbrn-geometry.ts`) already
  check their final points against the same limit.

### Decision

1. **DXF and HPGL check where the drawing lands.** `importedArtworkInRange(bounds, paths)`
   (`src/io/project/imported-artwork-range.ts`) checks the stored bounds and every polyline point and
   curve point (cubic controls, arc radii) against the loader's limit, after the shift to the
   corner, INSERT placement and spline evaluation. `buildDxfResult` returns an error and
   `hpglResult` throws an `out-of-range` `HpglError` instead of an object, with the reason
   `This DXF drawing spans 1,800,010 × 0 mm, but a KerfDesk project holds coordinates only up to
   1,000,000 mm, so it could never be saved. Check the file’s units, or delete stray objects far from
   the design in the program that made it, then import it again.` The open document is unchanged.
   The whole file is refused rather than an entity dropped: the importer cannot tell the stray from
   the design, and a site plan in the wrong units has no stray at all.
2. **A refusal names the object.** When the loader's first refusal points into `scene.objects[i]`,
   `nameRefusedSceneObject` (`src/io/project/refused-scene-object.ts`) rewrites it for Save
   (`prepareProjectForPersistence`) and autosave (`prepareProjectForAutosave`). An object past the
   coordinate limit reads `object 2 (imported from “site.dxf”) has coordinates past the 1,000,000 mm a
   project file can hold. Delete it (or undo its import) and save again.` Any other refusal inside an
   object reads `object 2 (…) cannot be stored (<loader reason>)`. The label is the operator's name
   for the object, else its source file, else its kind. Refusals outside the scene objects are
   unchanged.
3. **Autosave quotes the refusal.** An `invalid-project` autosave failure warns
   `Autosave cannot keep a recovery copy, and Save will refuse it too: <reason>.` instead of the
   storage message, once per session per reason. Storage failures keep the storage message.
4. **The recovery copy reopens.** `planRecoveryCopy` (`src/ui/app/recovery-copy-plan.ts`) leaves the
   objects past the coordinate limit out of the copy, repairing groups, masks, path-text guides and
   empty operations as deleting them would. The prompt reads `Export a recovery copy without object 2
   (imported from “site.dxf”) to a new file instead? Everything else is kept, and the copy opens as a
   normal project.`, and the toast names what was left out. With no such object, the copy stays the
   raw one, with its "may need repair" wording. The copy still never becomes the saved file and never
   clears autosave (ADR-204).

### Consequences

- A DXF or HPGL file whose placed drawing reaches past 1,000,000 mm is refused at import, with
  nothing lost, instead of leaving a project that cannot be saved or autosaved. A drawing just inside
  the limit (an INSERT at X 900,000, a 300 mm plot) imports and saves as before.
- A project that still reaches the limit by another route names the object at Save and autosave,
  and its recovery copy opens.
- Not changed: the per-entity DXF gate (it still skips an entity whose own values are unreadable),
  the bed fit, and the loader limit itself. PDF/AI import against the limit was not measured
  (audit W5, Not verified).

### Evidence

- `src/io/project/imported-artwork-range.test.ts`: the five DXF cases and both HPGL cases above are
  refused with the extent; `1,800,010 × 0 mm` and `1,025,010 × 10 mm` are named; an INSERT at
  X 900,000 and a 300 mm plot import and pass Save.
- `src/ui/app/out-of-range-object-save.test.ts`: Save and autosave name `object 2 (imported from
  “site.dxf”)`; the autosave warning quotes it, not the storage message; a NaN workspace width keeps
  the loader's words; through `handleSaveProject`, the prompt offers the copy without the object, the
  toast names it, and the written file reopens with the other object.
- With the source change reverted, every refusal case in both files fails.
- Not verified: the toasts and prompt seen in the running app.
