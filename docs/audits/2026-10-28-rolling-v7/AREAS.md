# Rolling audit v7 — design areas

**Requested** by the user on 2026-10-28: "next loop. test design areas".

**Scope.** This round audits KerfDesk's design side, meaning everything a user does to make and edit artwork before output:
- the main workspace tools;
- Design Studio, the constraint sketcher from ADR-272;
- text;
- booleans and offsets;
- transforms;
- design file round trips.

Earlier rounds covered output, controllers, tracing and burn quality. Design had only been touched incidentally, for example 08 canvas, 15 text and 10 geometry in rolling v2, and M7.

**Finding IDs** are `L<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3 with its clarifications: P1 has no reach clause, and Frame is not a warning.
- §4: pinned citations, and ADR quotes only from `docs/decisions` / `DECISIONS.md`.

Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.

### Lenses for this round
- **L2 ground truth.** Use analytic geometry (exact areas, perimeters, radii and positions), font metrics read from the font file, and LightBurn's documented tool behaviour at a versioned URL.
- **Test-only reference libraries.** These may be run as test-only references, never shipped: the repo's own `clipper2-ts` (BSL-1.0, already a dependency) and any permissively licensed geometry library.
- **L3 twins.** The canvas display, the Inspector or readout, the saved file, the exported file and the compiled output should all agree on one design.
- **L4 adversarial geometry.**
  - coincident and touching edges;
  - self-intersections;
  - holes inside holes;
  - zero-length segments;
  - tiny or huge sizes;
  - near-tangent curves;
  - open paths fed to closed-path operations.
- **L7 test truth.** Does a test pin the behaviour, and would it fail if the behaviour broke?
- **L9 entry-point parity.** The same operation through the main workspace, Design Studio, menus and shortcuts, and the remote/MCP design commands (`apply_edits` and related).

### Severity for design
- **P1:** a design operation produces geometry that differs in size, position or shape from what the user typed or what the app shows, or it silently drops or merges shapes or holes, so the burn is wrong with no warning. Losing design work also counts.
- **P2:** visibly wrong behaviour an ordinary user will notice. Examples: a wrong boolean result on screen, a broken or partial Undo, a misleading readout, or an operation that refuses valid input.
- **P3:** an improvement, or a test gap.

## Areas (run order)

| # | Area id | Scope | Lenses |
|---|---|---|---|
| L1 | `boolean-offset-weld` | See below | L2, L4, L3, L7 |
| L2 | `shapes-dimensions` | See below | L2, L3, L4 |
| L3 | `text-typography` | See below | L2, L3, L4 |
| L4 | `transform-arrange` | See below | L2, L4, L9 |
| L5 | `design-studio-sketch` | See below | L2, L3, L4, L7 |
| L6 | `node-edit-curves` | See below | L2, L4, L3 |
| L7 | `design-io-roundtrip` | See below | L3, L2, L4 |
| L8 | `canvas-interaction-history` | See below | L3, L9, L7 |

### L1 `boolean-offset-weld`
- **Code:**
  - vector booleans (ADR-103): `src/core/geometry/vector-path-booleans.ts`, `boolean-compound.ts`;
  - weld (ADR-263, ADR-321): `vector-path-weld*.ts`;
  - offset (ADR-410 and its amendments): `offset-shapes.ts`, `offset-ladder.ts`, `kerf-offset.ts`;
  - path cleanup: `close-within-tolerance`, `contour-auto-join`, `collapse-tiny-segments`.
- **Checks:**
  - area and topology against analytic truth and test-only `clipper2-ts`;
  - fill rule (even-odd vs nonzero);
  - open-path handling;
  - corner joins and miter limits;
  - the curves kept after an operation.

### L2 `shapes-dimensions`
- **Code:**
  - primitives and numeric entry (`src/core/shapes`, `shape-from-drag`, `rematerialize-shape`);
  - Shape Inspector fields;
  - unit entry and display (mm/in, `numeric-expression.ts`, `display-length.ts`, `format-display-millimetres.ts`);
  - the curve approximation of ellipses and arcs;
  - the registration box.
- **Checks:** typed value against stored geometry against the displayed value; rounding drift on re-entry.

### L3 `text-typography`
- **Code:**
  - text layout (`src/core/text`): embedded fonts, kerning, line spacing, alignment, text box max width, bidi;
  - text bend and text on path;
  - glyph coverage and fallback;
  - Hershey stroke fonts (ADR-194);
  - glyph weld (ADR-321);
  - convert to paths;
  - drafts and commit (ADR-320).
- **Checks:** glyph positions and sizes against metrics read from the font file; that converted paths are the same size as the displayed text.

### L4 `transform-arrange`
- **Code:**
  - move, scale, rotate and mirror (numeric and handles);
  - accumulated error over repeated transforms;
  - align and distribute;
  - arrays, rectangular and circular (ADR-307);
  - copy along path;
  - groups and lock;
  - snapping and grid;
  - Point Rotation;
  - Design Studio's arrange, scale, stretch and translate ops;
  - remote/MCP transform parity.

### L5 `design-studio-sketch`
- **Code:**
  - Design Studio (ADR-272);
  - the constraint solver (`src/core/sketch-constraints`): convergence, over- and under-constrained reporting, stability under drag;
  - sketch → scene object fidelity (`to-scene-object`, `materialize-constrained-sketch`);
  - fillet, chamfer and extend ops;
  - measure annotations;
  - design history and Undo;
  - session recovery (`design-recovery-*`).
- **Note:** a Pro feature. Build or test with `vite --mode desktop` where needed.

### L6 `node-edit-curves`
- **Code:**
  - node editing: delete and insert nodes;
  - segment edit;
  - smooth/corner;
  - break, join and close path;
  - fillet and chamfer on curves;
  - extend;
  - arc fit and arc representation;
  - cubic fit and curve fairing.
- **Checks:** precision kept through edits; the curve against the polyline representation; Undo.

### L7 `design-io-roundtrip`
- **Code:**
  - design export (`src/core/vector-export`: SVG / DXF / others), then re-import;
  - `.lf2` save and load of every design object type (shapes, text, groups, booleans, Design Studio sketches, masks);
  - copy/paste within and between projects;
  - clipboard formats.
- **Checks:** scale, units, curves, holes, text, layers and colours preserved; structure of the exported files as LightBurn and Inkscape read them (spec-level).

### L8 `canvas-interaction-history`
- **Code:**
  - selection and hit testing (open vs closed paths, fill vs stroke, nested groups, locked objects);
  - zoom and pan precision;
  - rulers and measurement readouts;
  - keyboard shortcut parity with LightBurn's documented shortcuts;
  - the a11y basics (`src/ui/a11y`).
- **Checks:** Undo/Redo coherence across every design operation. Each operation should be one step, and Redo should restore exactly.

## Batching

- At most two audit subagents at a time. The PC is low on memory, and fix sessions are running.
- A refuter goes before the next auditor.
- Repros run on the scratchpad `j7-main` tree, a copy of main's source. Re-check it whenever main moves.
