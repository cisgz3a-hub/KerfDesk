## ADR-408 - Trace settings travel with the trace (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-027 (Trace runs on a selected raster) and the Re-trace Original command. It adds
an optional field to trace results; it changes no geometry, compile, preview or output path, and the
Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

Re-trace Original (`tools.retrace-original`) reopens the Trace dialog on the kept source bitmap and
replaces the selected trace in place. The dialog state (preset, the LightBurn-style overrides,
detection mode, output type, fill style, boundary region and its crop/enhance mode) lived only in
React state and was lost when the dialog closed. On the base (`fa8939b8d`), a trace committed with
Smooth, Follow Shape fill, Smoothness 0.5 and an Enhance boundary reopened on Line Art, Scanline,
the preset Smoothness and no boundary, and the Delete Image After trace box was ticked again, so the
default re-trace deleted the source and ended re-tracing. The tracer-gap brief notes that LightBurn's
Trace Image cannot re-trace a committed trace at all, so keeping the settings is a lead, not parity.

Project files (`.lf2`, schema v9) keep unknown object fields: `deserializeProject` spreads each scene
object, and shape validation checks only the fields it knows. Save runs the ADR-204 drift check,
which refuses a save whose normalization would change a scene object.

Options considered:

- A. Store the effective `TraceOptions` (the merged preset plus overrides). Rejected: it freezes
  every internal tracer knob, so a later preset improvement would never reach a re-trace, and the
  dialog cannot show it as the preset plus the operator's edits.
- B. Store the preset name plus the operator's overrides and dialog choices (chosen). It is what the
  operator chose, it re-derives through the current preset, and it is small.
- C. Bump the project schema. Rejected: the field is not output-bearing. A v9 reader that ignores it
  still produces the same job; it only reopens Re-trace on the defaults. The schema-bump rule in
  migrations.ts protects meanings older readers "cannot safely ignore"; this is one they can.

### Decision

1. `TracedImage` and `RasterImage` (a rasterized trace result) gain an optional `traceSettings`
   (`TraceSettingsRecord`, `core/scene/scene-object.ts`): `schemaVersion: 1`, `presetName`,
   `overrides` (the dialog's override record keyed by control), `output`, `fillStyle`, and
   `boundary` with `boundaryMode` in the source bitmap's pixel grid when a region was boxed. Nothing
   in compile, preview or output reads it. Missing means a trace committed before this decision.
   The record holds the operator's intent, not the effective commit: on CNC the output is forced to
   vector and centerline, edge or raster output submits Scanline regardless of the fill style, but
   the record keeps the dialog's choices, because the same project can be re-traced on a laser
   later, where they apply again.
2. The dialog records its choices at commit (`captureTraceSettings`,
   `ui/trace/trace-settings-snapshot.ts`, via `use-trace-dialog-settings.ts`), and the commit puts
   the record on the vector trace (`ImportImageDialog.tsx`) or carries it onto the raster result
   (`trace-raster-output.ts`). Re-trace Original passes the selected result's record to the dialog
   (`image-command-actions.ts`, `ui-store.ts`), which restores it once per dialog lifetime
   (`restoreTraceSettings`). Committing the re-trace records the choices again, so they persist
   across repeated re-traces.
3. Restoring keeps only what this build can honour: a preset the dialog does not offer falls back
   to the machine default, an override key the dialog does not know or whose value has the wrong
   type is ignored, a number is fitted to the range its control offers (so a hand-edited
   `smoothness: 1e6` reopens at 1.33), the boundary is fitted to the source grid (and dropped if
   nothing overlaps), and a Photo shading boundary reopens in Crop, matching the rule when that
   preset is picked. The rule table (`TRACE_OVERRIDE_RULES`) is `satisfies`-checked against
   `LightBurnTraceSettingOverrides`, so adding a control without deciding how it persists is a type
   error, and a test renders the real controls to keep the ranges in step. It also lists the line
   presets' `invert` (ADR-404) ahead of the build that adds it, so a recorded Invert survives on
   both sides of that merge; when merging, keep the `satisfies` check rather than loosening it.
   Because a commit records only the controls this build knows, re-tracing and committing in this
   build discards a newer build's controls; opening and saving without re-tracing keeps them.
4. A re-trace opens with Delete Image After trace cleared. The command is reachable only because the
   source was kept, and deleting it would end re-tracing; the operator can still tick it. Fresh
   traces keep the ticked default.
5. Persistence follows the library-provenance precedent for non-output metadata
   (`project-library-provenance-normalizer.ts`): `normalizeTraceSettingsRecord`
   (`io/project/project-trace-settings-normalizer.ts`) rebuilds a well-formed record, so it can
   never refuse a project load and the trace itself loads unchanged. It drops the whole record when
   it is structurally unusable: not an object, a `schemaVersion` other than 1 (a newer record
   format is discarded whole, not partly read), a missing, blank or over-long preset name,
   `overrides` that is not an object or holds more than 64 entries, an unknown output, fill style
   or boundary mode, or a boundary that is not non-negative and finite with positive size. It
   drops a single override entry, keeping the rest of the record, when its key does not match
   `[A-Za-z][A-Za-z0-9]{0,63}` (which rules out prototype-shaped keys) or its value is not a finite
   number, a boolean or a string of at most 128 characters; a future non-primitive control value
   such as a range or an object is therefore lost on load, while well-formed unknown keys are kept
   so a newer build's primitive controls survive a save by this one. Unknown top-level record
   fields are not kept: adding one needs a new record `schemaVersion`. The allowed output, fill
   style and boundary mode lists are `satisfies`-checked against `TraceSettingsRecord`, so a new
   value cannot be added to the type without the loader accepting it. A well-formed record is kept
   on any scene object kind, not only on traced images and raster images: only Re-trace reads it,
   and stripping it from an object rebuilt from a trace under another kind would make the ADR-204
   drift check refuse the save. The record is rebuilt in place, so a clean save stays
   byte-identical. No schema version bump.

### Consequences

- Before: Re-trace Original restored none of the dialog's choices. After: preset, every override,
  output type, fill style, boundary and boundary mode reopen as committed, through save and load.
- A recorded trace adds 150 to 400 bytes to a pretty-printed project (155 for defaults with no
  overrides; 395 for four overrides plus a boundary), against 337,044 bytes of path data for the
  ADR-391 logo trace.
- Projects saved before this decision, at v9 or migrated from v8, load unchanged and re-trace on the
  defaults. A v9 build without this decision keeps the field through its own saves (unknown object
  fields pass through) and ignores it.
- The record describes the dialog, not the tracer: a re-trace after a preset changes in a later
  build uses the new preset with the operator's overrides.
- Tests: `ImportImageDialog.retrace-settings.test.tsx` drives the real dialog through commit, the
  real `.lf2` serializer and deserializer, the real Re-trace command, the pre-filled dialog, and a
  second commit, and again through the real store actions (laser and CNC, vector and rasterized
  results) and `prepareProjectForPersistence`; `project-trace-settings.test.ts` covers round-trip,
  save without drift, older projects including a hand-written v8 document, unknown override keys,
  13 structurally malformed or hostile records dropped whole, 6 bad override entries dropped on
  their own, and a record on a non-trace object kind; `trace-settings-snapshot.test.ts` covers
  restore fallbacks, range fitting and Invert; `trace-settings-snapshot.ranges.test.tsx` checks the
  persisted ranges against the rendered controls; `ImportImageDialog.raster-output.test.ts` covers
  the raster result.

Not part of this decision: pre-filling a fresh Trace of a raster from its previous trace; recording
Photo shading's source transparency or preview zoom; a "reset to recorded settings" control.
