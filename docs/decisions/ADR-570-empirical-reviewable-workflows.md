## ADR-570 - Integrate empirical and reviewable manufacturing workflows

Date: 2026-10-07. Status: accepted; local implementation integrated.

### Context

The xTool Studio audit identifies useful connections between existing KerfDesk features: material test results and recipes, reviewable vector changes, purpose-driven nesting and portable support evidence. KerfDesk already owns its recipe revisions, text/path engine, laser/CNC operation bindings and exact job handoff. Copying a vendor's hardware assumptions or replacing those foundations would reduce portability.

### Decision

Implement original device-neutral workflows over existing core models. Store empirical material evidence in the existing portable material-library document, with explicit versioning and strict input validation. Review changes before committing them and retain source identity where offered. Nesting workers publish valid best-so-far drafts; applying a draft requires its unchanged document owner. Diagnostic exports are local, bounded and redacted, with an inspectable preview.

Keep manufacturing execution separate from design organisation and result notes. An observation or production-note status is not controller or physical-completion proof. Device-specific focus, firmware, network and conveyor operations require an independently documented adapter and qualification; no universal protocol is inferred.

Project schema 13 adds optional sheets, production manifests, retained arrays, design names/group parents, text frames and fixture templates. Material-library schema 3 adds empirical experiments and reads previous versions. Inactive scenes, production seeds/reviewed variants and array source/baseline snapshots share one bounded archive traversal: 50 million cumulative characters and 50,100 entries, enforced at import and before authoring commits. The existing browser file-admission boundary inspects these archives as well.

Production allocation freezes row identity, CSV values, sequence offsets and date once. Opening or recording a result does not advance the cursor. Captured variants contain fixed text/barcodes and require a paired timestamp. Retained arrays keep owned identities and source intent; regeneration refuses independently edited members or new external references, and explicit expansion preserves the copies. Sheet replacement uses normal document ownership and retains the file's save destination.

Text frames use shared layout/rendering for editor and variable output, with explicit overflow. Design hierarchy affects organisation and focus only. Boolean results remain ordinary geometry with optional retained operands; a live compound model is not implied. Local project snapshots are separately bounded portable copies in local storage, not cloud revision history.

Stamp preparation generates an original tapered height map from raw raster pixels/masks or closed vector faces using physical pixel spacing. It preserves source artwork and requires preview review before adding an image or exporting PNG. It does not infer process depth, laser power, machine motion or material qualification. Rotary visualisation explains the existing settings without changing output.

Preserve ADR-565 spatial Frame evidence and Start-time exact-program ownership, current tool-admission licensing, and ADR-306 CNC settings ownership. Add no output policy gate. No controller motion or settings write is introduced by evidence capture or diagnostics.

### Verification

Focused core/component tests, schema migration/round-trip tests and integrated type/lint/build/runtime checks are recorded in the [implementation list](../implementation/xtool-workflows-20261007.md) and its [verification record](../implementation/xtool-workflows-verification-20261007.md). Material, sensor, controller and packaged-installation evidence are separate and are not established by this ADR.
