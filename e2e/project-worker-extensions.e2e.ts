import { expect, test } from './fixtures/kerfdesk-test';

test('preserved project extensions cross the real output and design workers at both packing sizes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const scenePath = '/src/core/scene/index.ts';
    const projectPath = '/src/io/project/index.ts';
    const outputPath = '/src/ui/laser/output-preparation-worker-client.ts';
    const designPath = '/src/ui/workspace/design-scene-worker-client.ts';
    const preparePath = '/src/io/gcode/prepare-output.ts';
    const scene = (await import(
      /* @vite-ignore */ scenePath
    )) as typeof import('../src/core/scene');
    const io = (await import(/* @vite-ignore */ projectPath)) as typeof import('../src/io/project');
    const output = (await import(
      /* @vite-ignore */ outputPath
    )) as typeof import('../src/ui/laser/output-preparation-worker-client');
    const design = (await import(
      /* @vite-ignore */ designPath
    )) as typeof import('../src/ui/workspace/design-scene-worker-client');
    const prepare = (await import(
      /* @vite-ignore */ preparePath
    )) as typeof import('../src/io/gcode/prepare-output');
    const results = [];
    for (const count of [2, 5001]) {
      const project = scene.createProject();
      const extended = {
        ...project,
        kind: 'packed-project',
        project: scene.createProject(),
        geometry: [{ index: 0, paths: [] }],
        scene: {
          layers: [scene.createLayer({ id: 'black', color: '#000000' })],
          objects: [
            {
              kind: 'imported-svg' as const,
              id: 'vector',
              source: 'worker-extension.svg',
              transform: scene.IDENTITY_TRANSFORM,
              bounds: { minX: 10, minY: 10, maxX: 20, maxY: 10 },
              paths: [
                {
                  color: '#000000',
                  polylines: [
                    {
                      closed: false,
                      points: Array.from({ length: count }, (_, i) => ({
                        x: 10 + (10 * i) / (count - 1),
                        y: 10,
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      const loaded = io.deserializeProject(io.serializeProject(extended));
      if (loaded.kind !== 'ok') throw new Error('Extended project failed to open');
      const expected = prepare.prepareOutput(loaded.project);
      const pending = output.prepareOutputOffThread({
        kind: 'prepare',
        project: loaded.project,
        options: {},
      });
      if (pending === null) throw new Error('Output worker is unavailable');
      const { prepared } = await pending;
      if (!prepared.ok || !expected.ok) throw new Error('Output preparation failed');
      const designPending = design.computeDesignSceneSourceOffThread(
        loaded.project,
        scene.DEFAULT_OUTPUT_SCOPE,
      );
      if (designPending === null) throw new Error('Design worker is unavailable');
      const designSource = await designPending;
      const preserved = prepared.project as typeof extended;
      results.push({
        count,
        matchingJob: JSON.stringify(prepared.job) === JSON.stringify(expected.job),
        groups: prepared.job.groups.length,
        kind: preserved.kind,
        nestedProject: preserved.project.schemaVersion,
        geometry: preserved.geometry,
        designSource,
      });
    }
    design.resetDesignSceneWorkerForTests();
    return results;
  });
  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.matchingJob).toBe(true);
    expect(result.groups).toBeGreaterThan(0);
    expect(result.kind).toBe('packed-project');
    expect(result.nestedProject).toBeGreaterThan(0);
    expect(result.geometry).toEqual([{ index: 0, paths: [] }]);
    expect(result.designSource).toBeNull(); // Laser projects have no CNC carve scene.
  }
  expect(workers.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  expect(workers.some((url) => url.includes('design-scene-worker'))).toBe(true);
});
