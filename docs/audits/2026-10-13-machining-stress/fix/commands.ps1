# Run from repository root. Reports here are a historical run; these commands
# print results without overwriting archived evidence. No hardware is used.
$evidencePath = 'docs/audits/2026-10-13-machining-stress'
$laserFiles = @(Get-Content "$evidencePath/laser-files.txt")
node node_modules/vitest/vitest.mjs run @laserFiles src/core/job/segment-entry-index-coincident.test.ts src/core/job/optimize-paths.test.ts --maxWorkers=1
$plannerFiles = @(Get-Content "$evidencePath/fix/planner-files.txt")
node node_modules/vitest/vitest.mjs run @plannerFiles --maxWorkers=1
$cncFiles = (Get-Content "$evidencePath/cnc-correctness-manifest.json" -Raw | ConvertFrom-Json).tests
node node_modules/vitest/vitest.mjs run @cncFiles --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config "$evidencePath/transport.vitest.config.mjs" --maxWorkers=1
node node_modules/vitest/vitest.mjs run src/core/controllers/ruida src/io/rd --maxWorkers=1

# Run timing commands sequentially after correctness and typecheck finish.
node scripts/stress-quality-first-paths.mjs
node scripts/stress-quality-first-paths.mjs --diagnose-coincident
$performanceFiles = @(Get-Content "$evidencePath/performance-files.txt")
node node_modules/vitest/vitest.mjs run @performanceFiles --maxWorkers=1
$previousCoverageBench = $env:LF_COVERAGE_BENCH
try {
    $env:LF_COVERAGE_BENCH = '1'
    node node_modules/vitest/vitest.mjs run src/core/cnc/vcarve-source-boundary-coverage-performance.test.ts --maxWorkers=1 -t 'reports matched dense coverage timing'
} finally {
    $env:LF_COVERAGE_BENCH = $previousCoverageBench
}

node "$evidencePath/fix/compare-entry-index.mjs"
pnpm typecheck
node node_modules/eslint/bin/eslint.js src/core/job/segment-entry-index.ts src/core/job/segment-entry-index-coincident.test.ts
node node_modules/prettier/bin/prettier.cjs --check src/core/job/segment-entry-index.ts src/core/job/segment-entry-index-coincident.test.ts
node scripts/check-adr-numbers.mjs
node scripts/check-file-size-policy.mjs
git diff --check
