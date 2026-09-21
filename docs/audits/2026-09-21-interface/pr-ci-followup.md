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

## Sharp trace timing

The hosted failure attachment records a successful worker result in **29,117.7 ms** with 101
heartbeats, 7,711 closed paths and 348,018 vertices. Its strict **30,000 ms** compute ceiling
passed. The old test then used the remaining compute allowance, less than 883 ms, for result
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
