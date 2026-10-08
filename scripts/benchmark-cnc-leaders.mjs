// Shared software fixtures; timings exclude controller, hardware and operator handling.
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { format, resolveConfig } from 'prettier';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const outputIndex = process.argv.indexOf('--output');
const server = await createServer({
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
  logLevel: 'error',
});
const load = (path) => server.ssrLoadModule('/src/' + path);
async function softwareIdentity() {
  const sourcePaths = (await readdir('src', { recursive: true }))
    .filter((path) => /\.(ts|tsx|js|mjs|json|css|svg)$/.test(path))
    .map((path) => 'src/' + path.replaceAll('\\', '/'));
  const paths = [
    ...sourcePaths,
    'scripts/benchmark-cnc-leaders.mjs',
    'package.json',
    'pnpm-lock.yaml',
    'vite.config.ts',
  ].sort();
  const records = await Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: hash(await readFile(path)),
    })),
  );
  const buildInfo = await load('platform/web/build-info.ts');
  return {
    version: buildInfo.appVersion(),
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeModified:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    sourceFiles: paths.length,
    sourceTreeSha256: hash(JSON.stringify(records)),
    sourceTreeConvention:
      'SHA-256 over sorted path/content-digest records for source code and benchmark/build inputs; local uncommitted source included.',
  };
}
try {
  const [
    fixtures,
    relief,
    nest,
    projectIO,
    gcode,
    viewer,
    facts,
    reach,
    preparation,
    sheets,
    nestPlanner,
  ] = await Promise.all([
    load('__fixtures__/cnc-leader-fixtures.ts'),
    load('__fixtures__/cnc-leader-relief-fixture.ts'),
    load('__fixtures__/cnc-leader-nest-fixture.ts'),
    load('io/project/index.ts'),
    load('io/gcode/index.ts'),
    load('core/gcode-view/index.ts'),
    load('io/cnc/cnc-program-facts.ts'),
    load('io/cnc/cnc-program-reach.ts'),
    load('ui/state/prepare-production-nest.ts'),
    load('ui/state/production-nest-sheet-materialize.ts'),
    load('core/nesting/production-nest-plan.ts'),
  ]);
  const cases = [
    { id: 'sign', variant: 'letters-holes-tabs', project: fixtures.signBenchmark() },
    ...fixtures.inlayBenchmarks().map((c) => ({ ...c, id: 'inlay' })),
    {
      id: 'relief',
      variant: 'dome-ornament-letter-clipped-border',
      project: relief.reliefBenchmark(),
    },
    {
      id: 'reach',
      variant: 'long-and-short-assemblies-with-clamp',
      project: fixtures.reachBenchmark(),
    },
    ...fixtures.twoSidedBenchmark().map((c) => ({ ...c, id: 'two-sided' })),
    ...fixtures.sketchBenchmarks().map((c) => ({ ...c, id: 'parametric-bracket' })),
  ];
  const results = [];
  for (const fixture of cases) results.push(runProject(fixture));
  const nested = nest.leaderNestBenchmark();
  const preparedNest = preparation.prepareProductionNest(nested.project, nested.definition);
  if (preparedNest.kind !== 'ok') throw new Error(preparedNest.reason);
  const times = [];
  let planned;
  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    planned = nestPlanner.planProductionNest(preparedNest.value.input);
    times.push(performance.now() - start);
  }
  assert.equal(planned.produced, 12);
  assert.equal(planned.unplaced, 0);
  for (const sheet of planned.sheets)
    for (const placement of sheet.placements)
      assert.ok(
        (placement.rotationDeg ?? (placement.rotated90 ? 90 : 0)) === 0 ||
          placement.rotationDeg === 180,
        'grain must keep panel longitudinal axis aligned',
      );
  const copied = sheets.materializeProductionSheets(preparedNest.value, planned, false);
  if (copied.kind !== 'ok') throw new Error(copied.reason);
  const nestPrograms = [];
  for (const archive of copied.value.sheetBook.inactive) {
    const reopened = projectIO.deserializeProject(archive.projectJson);
    if (reopened.kind !== 'ok') throw new Error('Generated nesting sheet could not reopen');
    nestPrograms.push(
      runProject({ id: 'production-nesting', variant: archive.id, project: reopened.project }),
    );
  }
  results.push({
    id: 'production-nesting',
    variant: '12-grained-panels-two-stock-sizes',
    inputSha256: hash(JSON.stringify(preparedNest.value.input)),
    definition: nested.definition,
    requested: planned.requested,
    produced: planned.produced,
    unplaced: planned.unplaced,
    sheets: planned.sheets.length,
    stockAreaMm2: planned.stockAreaMm2,
    occupiedAreaMm2: planned.occupiedAreaMm2,
    stockUtilisationPercent: planned.stockUtilisationPercent,
    vectorEstimateMm: planned.vectorLengthMm,
    placementTravelEstimateMm: planned.placementTravelMm,
    plannerTimesMs: times,
    generatedPrograms: nestPrograms,
  });
  const accountability = viewer.buildGcodeRenderModel(nest.INTERRUPTED_ACCOUNTABILITY_PROGRAM, {
    machineKind: 'cnc',
    retainPreciseSegmentLengths: true,
  });
  if (accountability.kind !== 'ok') throw new Error(accountability.reason);
  const model = accountability.model;
  assert.ok(model.skippedMotions.length > 0, 'invalid imported arc must remain accountable');
  results.push({
    id: 'interruption-accountability',
    variant: 'imported-bad-arc-and-canned-cycle',
    inputSha256: hash(nest.INTERRUPTED_ACCOUNTABILITY_PROGRAM),
    program: nest.INTERRUPTED_ACCOUNTABILITY_PROGRAM,
    lineCount: model.lineCount,
    lineCategories: Array.from(model.lineCategories),
    skippedMotions: model.skippedMotions,
    unsupportedWords: model.unsupportedWords,
    events: model.events,
    mockReceipt: {
      simulated: true,
      sentRawRows: 12,
      acknowledgedRawRows: 9,
      physicallyExecutedRawRows: null,
    },
    qualification:
      'Parser and synthetic receipt only; acknowledgement is not proof of physical execution. No automatic recovery was sent.',
  });
  const report = {
    generatedAt: new Date().toISOString(),
    software: await softwareIdentity(),
    runtime: process.version,
    platform: process.platform,
    scope: 'KerfDesk local software fixtures only',
    competitorMeasurements: null,
    physicalMeasurements: null,
    timingConvention:
      'Three preparation samples; fed-motion minutes sum geometric move/feed and exclude acceleration, rapids, M0/operator handling and physical cutting.',
    fixtureCount: 8,
    results,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (outputIndex >= 0) {
    const path = process.argv[outputIndex + 1];
    if (!path) throw new Error('Missing --output path');
    await writeFile(path, await format(json, { ...(await resolveConfig(path)), filepath: path }));
  }
  console.log(
    outputIndex < 0
      ? json
      : JSON.stringify(
          {
            fixtureCount: report.fixtureCount,
            results: results.map(
              ({ id, variant, passCount, stats, produced, sheets, reachWarnings }) => ({
                id,
                variant,
                passCount,
                cutMm: stats?.cutMm,
                travelMm: stats?.travelMm,
                produced,
                sheets,
                reachWarnings: reachWarnings?.length,
              }),
            ),
          },
          null,
          2,
        ),
  );
  function runProject(fixture) {
    const source = projectIO.serializeProject(fixture.project),
      reopened = projectIO.deserializeProject(source);
    if (reopened.kind !== 'ok') throw new Error(fixture.id + ': ' + JSON.stringify(reopened));
    const times = [];
    let prepared;
    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();
      prepared = gcode.prepareOutput(reopened.project);
      times.push(performance.now() - start);
    }
    if (!prepared.ok) throw new Error(fixture.id + ': ' + JSON.stringify(prepared.preflight));
    const emitted = gcode.emitGcode(reopened.project);
    assert.ok(emitted.gcode.length > 0, fixture.id + ' must emit a program');
    const parsed = viewer.buildGcodeRenderModel(emitted.gcode, {
      machineKind: 'cnc',
      coordinateRepresentation: 'grbl',
      retainPreciseSegmentLengths: true,
      maxSegments: 500000,
    });
    if (parsed.kind !== 'ok') throw new Error(fixture.id + ': ' + parsed.reason);
    const programFacts = facts.cncProgramFacts(prepared.job, prepared.project);
    let fedMotionMinutes = 0;
    for (let i = 0; i < parsed.model.segFeed.length; i += 1) {
      if (parsed.model.segMotion[i] === viewer.SEG_MOTION.rapid) continue;
      const feed = parsed.model.segFeed[i],
        length = parsed.model.segLengthMm?.[i] ?? 0;
      if (feed > 0) fedMotionMinutes += length / feed;
    }
    return {
      id: fixture.id,
      variant: fixture.variant,
      inputSha256: hash(source),
      programSha256: hash(emitted.gcode),
      programBytes: Buffer.byteLength(emitted.gcode),
      sourceProject: JSON.parse(source),
      preparationTimesMs: times,
      groups: prepared.job.groups.length,
      passCount: prepared.job.groups.reduce(
        (n, g) => n + (g.kind === 'cnc' ? g.passes.length : 0),
        0,
      ),
      programFacts,
      stats: parsed.model.stats,
      fedMotionMinutes,
      skippedMotions: parsed.model.skippedMotions,
      unsupportedWords: parsed.model.unsupportedWords,
      compileDiagnostics: prepared.job.diagnostics ?? [],
      reliefPlans: prepared.job.cncCompilation?.reliefPlans ?? [],
      reachWarnings: reach.cncProgramReachWarnings(
        prepared.project,
        emitted.gcode,
        programFacts.toolPlan,
      ),
      advisoryCount: prepared.advisories?.length ?? 0,
    };
  }
} finally {
  await server.close();
}
