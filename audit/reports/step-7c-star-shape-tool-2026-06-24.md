# Step 7C: Star Shape Tool V1

Date: 2026-06-24
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: no-hardware workspace polish
Rating: 10/10

## Locked Goal

Add a first-class Star drawing tool that behaves like the existing rectangle,
ellipse, polygon, and polyline tools:

- Star appears in the left drawing tool strip with its own help text and icon.
- Dragging with the Star tool creates a persisted `kind: "star"` shape object.
- Star geometry is a closed, concave five-point outline with alternating outer
  and inner vertices.
- Saved `.lf2` projects round-trip star shapes and reject malformed star specs.
- No G-code emitter, controller, or hardware behavior changes.

Out of scope: editable star point count, inner-radius UI, shortcuts, rotary,
camera, controller changes, and hardware smoke.

## Research And Existing Patterns

- `src/core/shapes/shape-from-drag.ts`: existing draw tools create parametric
  `ShapeObject` values from a drag box.
- `src/core/shapes/polygon.ts` and `src/core/shapes/create-polygon.ts`: polygon
  geometry pattern, first vertex up, repeated first point for stroke closure.
- `src/core/scene/scene-object.ts`: `ShapeSpec` is the persisted scene union.
- `src/io/project/project-shape-validator.ts`: `.lf2` validation must admit any
  new shape spec explicitly.
- `src/ui/workspace/ToolStrip.tsx`, `src/ui/help/help-topics.ts`, and
  `src/ui/kit/icons.tsx`: left rail tool pattern.

No Rayforge code was copied.

## Failing Proof

Targeted red command:

```powershell
pnpm test src/core/shapes/star.test.ts src/core/shapes/shape-from-drag.test.ts src/ui/workspace/ToolStrip.test.tsx src/ui/help/help-topics.test.ts src/io/project/project.test.ts
```

Observed failures before implementation:

- `src/core/shapes/star.test.ts`: missing `./star` module.
- `shapeFromDrag > fills the visual drag box for a star`: received `polygon`
  instead of `star`.
- `ToolStrip > arms the Star tool`: tool mode stayed `select`.
- `help-topics`: `TOOL_HELP.star` was undefined.
- Project star round-trip: `createStar` was not a function.

## Implementation

- Added `StarShape`, `StarSpec`, `starToPolylines()`, and `createStar()`.
- Shared shape bounds derivation through `polyline-bounds.ts`.
- Added `star` to `DrawShapeKind`, drag creation, `ToolMode`, and `DragState`.
- Added Star button, icon, and help topic.
- Added `.lf2` validator support for star fields:
  - `points` integer in `[3, 64]`
  - positive `outerRadiusMm`
  - `innerRadiusRatio` in `(0, 1)`
- Split star project IO tests into `project-star-shape.test.ts` to preserve file
  size policy.

## Verification

Commands run:

```powershell
pnpm test src/core/shapes/star.test.ts src/core/shapes/shape-from-drag.test.ts src/ui/workspace/ToolStrip.test.tsx src/ui/help/help-topics.test.ts src/io/project/project-star-shape.test.ts
pnpm typecheck
pnpm lint
pnpm check:file-size
git diff --check
pnpm test
pnpm build:web
```

Results:

- Targeted tests: 5 files, 28 tests passed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with the pre-existing boundaries legacy-selector warning.
- `pnpm check:file-size`: passed.
- `git diff --check`: passed.
- Full suite: 349 files, 2150 tests passed. Existing jsdom act warnings remain
  in `use-canvas-bitmap-size.test.tsx`.
- `pnpm build:web`: passed. Existing Vite large chunk warning remains.

Browser smoke:

- In-app browser automation attach timed out before page control, so the fallback
  was a dependency-free headless Chrome CDP smoke against
  `http://127.0.0.1:5173/`.
- Star button count: 1.
- Star button `aria-pressed`: `true`.
- Native Chrome mouse drag changed workspace canvas hash:
  `178655370 -> 173671941`.
- Star tool stayed armed after draw.
- Console/runtime error count: 0.

## Audit

Findings: none accepted.

Rejected concerns:

- "Star might not save/reopen": rejected. Dedicated `.lf2` round-trip test
  covers `createStar()` output, and malformed ratio validation is covered.
- "Star might hit emitter/controller paths": rejected. The implementation only
  adds a new closed vector shape; existing compile/preview code consumes
  materialized paths like other shapes.
- "ToolStrip might expose a hidden or unlabeled button": rejected. ToolStrip test
  checks the accessible label and active state; browser smoke clicked the real
  button.

Rubric:

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10
- Regression coverage: 10/10
- Real-artifact evidence: 10/10
- Maintainability: 10/10
- Docs/audit clarity: 10/10

Final rating: 10/10.
