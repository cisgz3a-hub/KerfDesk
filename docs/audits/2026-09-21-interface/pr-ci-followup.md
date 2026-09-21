# PR #828 browser gate follow-up

The first hosted browser run on `c508774b93f3fd1fb59daeffe59ad8def2b1b321`
passed its cold-start case, then reported **135 passing and four failing** development-browser
cases. The production-browser stage was not reached. The failed
[Chrome UX smoke run](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/35628985044)
remains the original evidence; these fixes do not change its result.

## Toolbar fixtures

Both conversion cases still looked for Import inside More after the integrated toolbar moved
it to the primary row. The unqualified-image Trace case captured the overflow location during
an asynchronous import, then retained that locator when Trace moved to the primary row.

The conversion setup now uses the shared toolbar helper. That helper resolves the command
across its primary and overflow locations at action time. Workbench uses the same helper
instead of a second implementation. Conversion, PNG, Undo/Redo, cancellation and trace
assertions are unchanged.

The [targeted rerun](pr-ci-toolbar-regressions.json) passed **3/3 cases** on the development
server at port 5186:

```powershell
$env:PLAYWRIGHT_PORT='5186'
pnpm exec playwright test e2e/convert-bitmap.spec.ts e2e/workbench.e2e.ts --grep 'native conversion preserves|busy conversion prevents|unqualified bitmap legacy' '--reporter=list,json'
```

## Sharp trace timing: initial repair

This section preserves the initial repair at `e796b9aa`. The subsequent main integration below
supersedes that temporary test contract; it does not turn the failed local run into a pass.

The hosted failure attachment records a successful worker result in **29,117.7 ms** with 101
heartbeats, 7,711 closed paths and 348,018 vertices. The recorded duration is below the former
**30,000 ms** compute ceiling; the assertion itself was not reached after the preview failure.
The old test used the remaining compute allowance, less than 883 ms, for result
observation, probe geometry processing, SVG conversion and preview rendering. The subsequent
failure screenshot shows the ready preview.

The fixture now observes worker completion, asserts the same strict 30-second worker-timestamp
ceiling, and gives the preview a separate 10-second visibility allowance. The 90-second case
timeout, real geometry assertions, worker/heartbeat checks and committed-preview parity checks
remain. No product tracing code or performance assertion was relaxed.

The [local Sharp rerun](pr-ci-sharp-local.json) **failed**: the worker was still computing after
the 40-second observation window, with 140 heartbeats. It does not establish a local performance
pass. No cause for that local slowdown was established, and no repeated benchmark or increased
compute ceiling was used to obtain a passing result. Fresh hosted checks must independently
satisfy the unchanged compute limit before merge.

```powershell
$env:PLAYWRIGHT_PORT='5186'
pnpm exec playwright test e2e/trace-presets-stress-worker.e2e.ts --grep 'default Sharp' --workers=1 --output=artifacts/pr-publication/dragon-sharp-recheck --reporter=json
```

Browser-test TypeScript and scoped ESLint passed after these test-only changes. These repairs
did not alter application source or its catalogue digest. Main's subsequent tutorial update is
documented separately in [the final supplement](pr-final-tutorial-integration.md). No hardware
was operated.

## Subsequent main integration

Main `39eebb6fcb723a2e51f9866a7c0c7dedf396b981` ([PR #826](https://github.com/cisgz3a-hub/KerfDesk/pull/826))
independently corrects the same test to match ADR-336: the production watchdog limits **silence**,
not total tracing time. Its accepted fixture checks less than 30 seconds between worker messages,
retains a finite 180-second completion wait and 240-second case deadline, and allows 15 seconds
for rendering. It also verifies cancellation of an actively heartbeating native worker and
retains exact committed-geometry and responsiveness assertions.

The merge adopts that upstream fixture, superseding the temporary 30-second total-compute
assertion above. This is not a new passing performance claim: the failed local report remains
unchanged, and current tracing checks judge the documented liveness contract. No product tracing
algorithm was changed by this conflict resolution.

The original [release CI run](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/35628985399)
passed on `c508774b93f3fd1fb59daeffe59ad8def2b1b321`, including 15,112 passing unit cases,
22 skipped cases and 130 release-integrity tests. That result predates the later main integrations
and cannot replace required checks on the final PR commit.

## Native-worker observation follow-up

The [post-remediation native-worker run](pr-remediation-trace-initial.json) records one passing
Sharp commit case and one failed cancellation case. Sharp computed in **58,520.3 ms**, with
**2,415.8 ms** longest silence and 196 heartbeats, producing 7,711 closed polylines and 348,018
vertices. Exact saved-geometry equality and workspace responsiveness passed under the current
ADR-336 contract; this is not a sub-30-second performance result.

Cancel closed the dialog and terminated proxy owner 2. Playwright observed one closed worker:
the earlier owner 1 had been retired before the browser reported its creation. The fixture
incorrectly indexed browser observations by the proxy constructor ordinal and received
`undefined`. That failure occurred before Save and the no-commit assertions, so those assertions
were not established by this first attempt.

The correction captures the sole browser-observed open worker while the page probe separately
confirms exactly the expected unretired owner and an active heartbeat. Cancel must close that
captured record, leave zero observed open workers, terminate the exact proxy owner, and save
the original two-object project without a traced-image object. Supersession uses the same
observation barrier before starting its replacement; it must close the old record and retain
a distinct live replacement. Constructor order is no longer treated as browser event order.

The [focused follow-up](pr-remediation-trace-followup.json) passes **both changed cases** on
their first run after the correction. Cancellation reaches its complete project/no-commit
assertions. Supersession preserves source bytes, reports the old request as superseded and
completes a 32 × 32 replacement with one polyline and two vertices. Its recorded compute time
is 29.5 ms and longest silence is 538.1 ms. This is native browser-worker evidence with a test
observer; no physical controller or port was used.

Normal Sharp tracing, the heartbeat/progress probe, timing limits, geometry equality and
responsiveness assertions were unchanged by this final test-only fix. Browser-test TypeScript,
scoped ESLint and Prettier passed. The earlier failed reports remain intact.
