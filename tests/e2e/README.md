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

## Adding a fixture

1. Create a scene factory in `fixtures/yourScenario.ts` that returns a
   `Scene`. Keep the factory deterministic — no randomness, no current
   time references.

2. Create `yourScenario.test.ts` that:
   - Calls the factory
   - Pipes through `compileSceneToGcode` from `helpers/`
   - Makes structural assertions (e.g., contains expected G-codes)
   - Calls `expectMatchesSnapshot(gcode, 'your-scenario.gcode')`

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
