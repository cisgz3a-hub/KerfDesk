# E2E snapshot tests

Snapshot-based tests that catch regressions in the full compile pipeline
(scene → job → plan → machine transform → GRBL output).

## Running

```bash
npm test                      # runs all tests including e2e
UPDATE_SNAPSHOTS=1 npm test   # blesses any snapshot changes; use with care
```

On Windows PowerShell:

```powershell
$env:UPDATE_SNAPSHOTS='1'; npm test
```

## Special case: text fixtures

`compileJob` does not auto-convert text geometry to paths — that happens in
the UI compile flow via `expandTextOutlinesForCompile(scene)` before
compile. E2E fixtures with text must use `prepareSceneForCompile` from
`helpers/prepareSceneForCompile.ts` to mirror production (`PipelineService.compileGcode`).

Example:

```typescript
import { prepareSceneForCompile } from './helpers/prepareSceneForCompile';
import { compileSceneToGcode } from './helpers/compileToGcode';

const scene = makeTextScene();
const prepared = await prepareSceneForCompile(scene);
const gcode = compileSceneToGcode(prepared);
```

For Hershey fonts, outline data is vendored JSON — no async font file load.
For bundled outline fonts (Inter, etc.), `loadFont` resolves `/fonts/*` URLs
to `public/fonts/*` on disk in Node so headless tests use the same
`textGeometryToPath` → `textToPathOpentype` path as the browser.

## Perf fixtures

Large-scene and similar fixtures protect against accidental O(n²) or
allocation regressions. They do not snapshot output — snapshots of 1000+
lines flip on every optimizer change and teach nothing. Perf fixtures
assert a time budget and line-count bounds instead.

The budget is generous (2 seconds on CI) because runner hardware varies.
Locally, a 100-object compile should finish in well under 500 ms.

## Drift risk: production vs E2E scene prep

E2E currently mirrors `PipelineService.compileGcode` via
`prepareSceneForCompile` (same `expandTextOutlinesForCompile` call). If
production changes how scenes are prepared pre-compile and E2E does not
follow, snapshots will stop reflecting real user output.

**TODO:** extract a single `prepareForCompile(scene)` helper that both
production and E2E import so the two cannot drift. Not blocking the harness.

## Traced-image E2E (deferred)

A fixture that reads a small PNG, runs `traceToSceneObject` / imagetracerjs,
then compiles would cover import → trace → G-code. That path today uses
`document.createElement('canvas')` in `PotraceTracer.ts` and a Web Worker
for the async variant — neither is wired for headless Node in this repo
(no `canvas` polyfill dependency).

**Deferred:** add a checked-in reference PNG + e2e once a headless-safe trace
entry exists (or add a devDependency such as `canvas` and a thin adapter).
Raster/trace behavior remains covered by unit tests (e.g. image pipeline
tests) and manual QA.

## Adding a fixture

1. Create a scene factory in `fixtures/yourScenario.ts` that returns a
   `Scene`. Keep the factory deterministic — no randomness, no current
   time references.

2. Create `yourScenario.test.ts` that:
   - Calls the factory (and `await prepareSceneForCompile(scene)` if it contains text)
   - Pipes through `compileSceneToGcode` from `helpers/`
   - Makes structural assertions (e.g., contains expected G-codes)
   - Calls `expectMatchesSnapshot(gcode, 'your-scenario.gcode')` **unless**
     it is a perf-only fixture (see above).

3. Run once with `UPDATE_SNAPSHOTS=1` to create the initial snapshot.
   Manually review `snapshots/your-scenario.gcode` before committing.

4. Register in `scripts/run-tests.mjs`.

## When a snapshot breaks

A mismatch means something in the compile pipeline produces different
bytes for the same input scene. Possibilities:

- **Regression**: recent code change broke output. Investigate, fix,
  re-run without UPDATE_SNAPSHOTS to confirm.
- **Intended change**: you deliberately changed the output. Review the
  diff in the snapshot file, confirm it's what you want, then bless
  with `UPDATE_SNAPSHOTS=1`.

Always commit the snapshot file change in the same PR as the code
change so reviewers see both together.
