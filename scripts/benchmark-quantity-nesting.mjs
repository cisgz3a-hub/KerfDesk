// Reproducible C08 software benchmark. No controller, transport or hardware is used.
import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';

const server = await createServer({
  configFile: false,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
  logLevel: 'error',
});
try {
  const { productionFixture } = await server.ssrLoadModule(
    '/src/core/nesting/production-nest.test-fixture.ts',
  );
  const { planProductionNest } = await server.ssrLoadModule(
    '/src/core/nesting/production-nest-plan.ts',
  );
  const {
    createProject,
    createLayer,
    DEFAULT_CNC_LAYER_SETTINGS,
    DEFAULT_CNC_MACHINE_CONFIG,
    IDENTITY_TRANSFORM,
  } = await server.ssrLoadModule('/src/core/scene/index.ts');
  const { prepareProductionNest } = await server.ssrLoadModule(
    '/src/ui/state/prepare-production-nest.ts',
  );
  const { materializeProductionSheets } = await server.ssrLoadModule(
    '/src/ui/state/production-nest-sheet-materialize.ts',
  );
  const { deserializeProject } = await server.ssrLoadModule('/src/io/project/index.ts');
  const { prepareOutput } = await server.ssrLoadModule('/src/io/gcode/prepare-output.ts');
  const { cncGrblStrategy } = await server.ssrLoadModule('/src/core/output/index.ts');
  const { buildGcodeRenderModel } = await server.ssrLoadModule('/src/core/gcode-view/index.ts');
  const fixture = productionFixture();
  const base = createProject();
  const project = {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'profile', color: '#000000' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            depthMm: 1,
            depthPerPassMm: 1,
            tabsEnabled: false,
          },
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'source',
          source: 'panel.svg',
          name: 'Panel',
          operationIds: ['profile'],
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 20, y: 0 },
                    { x: 20, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const prepared = prepareProductionNest(project, fixture.definition);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  let result;
  const times = [];
  for (let trial = 0; trial < 10; trial += 1) {
    const start = performance.now();
    result = planProductionNest(prepared.value.input);
    times.push(performance.now() - start);
  }
  const generated = materializeProductionSheets(prepared.value, result, false);
  if (generated.kind !== 'ok') throw new Error(generated.reason);
  let cutMm = 0,
    travelMm = 0,
    plungeMm = 0,
    retractMm = 0;
  for (const sheet of generated.value.sheetBook.inactive) {
    const loaded = deserializeProject(sheet.projectJson);
    if (loaded.kind !== 'ok') throw new Error('Cannot reopen benchmark sheet');
    const executable = prepareOutput(loaded.project);
    if (!executable.ok) throw new Error('Benchmark output did not prepare');
    const parsed = buildGcodeRenderModel(
      cncGrblStrategy.emit(executable.job, loaded.project.device),
      { machineKind: 'cnc', coordinateRepresentation: 'grbl', retainPreciseSegmentLengths: true },
    );
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    cutMm += parsed.model.stats.cutMm;
    travelMm += parsed.model.stats.travelMm;
    plungeMm += parsed.model.stats.plungeMm;
    retractMm += parsed.model.stats.retractMm;
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        fixture: 'six 20x10 panels on two 46x26 stocks; gap2; on-path1mm one-pass profile',
        requested: result.requested,
        produced: result.produced,
        unplaced: result.unplaced,
        sheets: result.sheets.length,
        stockAreaMm2: result.stockAreaMm2,
        occupiedAreaMm2: result.occupiedAreaMm2,
        utilisationPercent: result.stockUtilisationPercent,
        vectorEstimateMm: result.vectorLengthMm,
        placementTravelEstimateMm: result.placementTravelMm,
        emittedCutMm: cutMm,
        emittedTravelMm: travelMm,
        emittedPlungeMm: plungeMm,
        emittedRetractMm: retractMm,
        plannerMedianMs: times[Math.floor(times.length / 2)],
        plannerMaxMs: times.at(-1),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
