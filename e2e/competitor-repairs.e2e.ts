import { writeFileSync } from 'node:fs';
import type { Project } from '../src/core/scene';
import type { Job } from '../src/core/job/job';
import { expect, test, type Page, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import {
  composedSvgSnapshot,
  exportComposedSvg,
  importComposedSvg,
  svgRedo,
  svgUndo,
} from './fixtures/composed-svg-browser';
import { clearCanvasProject } from './fixtures/mixed-canvas-project';
import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';

const svgCases = [
  {
    name: 'root-aspect',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
    bounds: { minX: 50, maxX: 150, minY: 0, maxY: 100 },
  },
  {
    name: 'nested-overflow',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><svg x="10" y="20" width="30" height="20" viewBox="0 0 30 20"><rect x="-10" y="-10" width="60" height="40"/></svg></svg>',
    bounds: { minX: 10, maxX: 40, minY: 20, maxY: 40 },
  },
  {
    name: 'percentage-geometry',
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><rect x="25%" y="20%" width="50%" height="40%"/></svg>',
    bounds: { minX: 50, maxX: 150, minY: 20, maxY: 60 },
  },
] as const;

for (const fixture of svgCases) {
  test(`SVG repair reaches the browser worker, canvas and export: ${fixture.name}`, async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await importComposedSvg(page, kerfdesk, `${fixture.name}.svg`, fixture.text, 1);
    const imported = await composedSvgSnapshot(page);
    const actual = vectorBounds(imported.project);
    for (const [edge, value] of Object.entries(fixture.bounds)) {
      expect(actual[edge as keyof typeof actual], edge).toBeCloseTo(value, 7);
    }
    expect(workers.some((url) => url.includes('document-import-worker'))).toBe(true);
    const exported = await exportComposedSvg(page, kerfdesk);
    writeFileSync(info.outputPath('exported.svg'), exported);
    writeFileSync(
      info.outputPath('imported-project.json'),
      JSON.stringify(imported.project, null, 2),
    );
    await page.screenshot({ path: info.outputPath('workspace-import.png') });
    await svgUndo(page, 0);
    await svgRedo(page, 1);
    expect((await composedSvgSnapshot(page)).project).toEqual(imported.project);
    await clearCanvasProject(page);
    await importComposedSvg(page, kerfdesk, 'reimported.svg', exported, 1);
    const reimported = await composedSvgSnapshot(page);
    const repeated = vectorBounds(reimported.project);
    expect(repeated.maxX - repeated.minX).toBeCloseTo(actual.maxX - actual.minX, 7);
    expect(repeated.maxY - repeated.minY).toBeCloseTo(actual.maxY - actual.minY, 7);
    await page.screenshot({ path: info.outputPath('workspace-reimport.png') });
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual(
      [],
    );
  });
}

test('Fill repair from the Tools menu adds output and survives Undo, Redo and save/reopen', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await importComposedSvg(
    page,
    kerfdesk,
    'open-fill.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path fill="none" stroke="#000000" d="M10 10 C20 10 20 20 10 20 L10.25 10.25 M30 30 H38 V38 H30 Z"/></svg>',
    1,
  );
  await selectWorkspacePanel(page, 'Artwork');
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  const fill = panel
    .getByRole('radiogroup', { name: /^Mode for/ })
    .getByRole('radio', { name: 'Fill', exact: true });
  await fill.check();
  await expect(fill).toBeChecked();
  const before = await compiledFill(page);
  expect(before.count).toBeGreaterThan(0);
  expect(before.closedCurves).toContain(false);
  const undoBefore = (await composedSvgSnapshot(page)).undoCount;
  await page.getByRole('menuitem', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close Open Fill Contours', exact: true }).click();
  await expect.poll(async () => (await compiledFill(page)).count).toBeGreaterThan(before.count);
  const repaired = await compiledFill(page);
  expect(repaired.closedCurves.every(Boolean)).toBe(true);
  expect(repaired.closedPolylines.every(Boolean)).toBe(true);
  expect((await composedSvgSnapshot(page)).undoCount).toBe(undoBefore + 1);
  await page.screenshot({ path: info.outputPath('workspace-repaired-fill.png') });
  await svgUndo(page, 1);
  expect(await compiledFill(page)).toEqual(before);
  await svgRedo(page, 1);
  expect(await compiledFill(page)).toEqual(repaired);
  const saved = await saveProject(page, kerfdesk);
  await kerfdesk.setOpenFiles([{ name: 'repaired-fill.lf2', text: saved }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/repaired-fill\.lf2/, { timeout: 30_000 });
  expect(await compiledFill(page)).toEqual(repaired);
  writeFileSync(info.outputPath('repaired-project.lf2'), saved);
  writeFileSync(info.outputPath('fill-output.json'), JSON.stringify({ before, repaired }, null, 2));
  await page.screenshot({ path: info.outputPath('workspace-reopened-fill.png') });
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});

function vectorBounds(project: Project) {
  const points = project.scene.objects.flatMap((object) =>
    'paths' in object
      ? object.paths.flatMap((path) => path.polylines.flatMap((line) => line.points))
      : [],
  );
  if (points.length === 0) throw new Error('Expected imported vector geometry');
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

async function compiledFill(page: Page) {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const compilePath = '/src/core/job/compile-job.ts';
    const [loadedStore, loadedCompiler] = await Promise.all([
      import(/* @vite-ignore */ storePath),
      import(/* @vite-ignore */ compilePath),
    ]);
    const store = loadedStore as { useStore: { getState: () => { project: Project } } };
    const compiler = loadedCompiler as {
      compileJob: (scene: Project['scene'], device: Project['device']) => Job;
    };
    const { project } = store.useStore.getState();
    const job = compiler.compileJob(project.scene, project.device);
    const paths = project.scene.objects.flatMap((object) =>
      'paths' in object ? object.paths : [],
    );
    return {
      count: job.groups.reduce(
        (count, group) => count + (group.kind === 'fill' ? group.segments.length : 0),
        0,
      ),
      closedCurves: paths.flatMap((path) => path.curves?.map((curve) => curve.closed) ?? []),
      closedPolylines: paths.flatMap((path) => path.polylines.map((line) => line.closed)),
    };
  });
}

async function saveProject(page: Page, fixture: KerfDeskFixture): Promise<string> {
  const previousCount = (await fixture.events()).filter(
    (event) => event.kind === 'file-saved',
  ).length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(
      async () => (await fixture.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBeGreaterThan(previousCount);
  const name = (await fixture.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const text = typeof name === 'string' ? (await fixture.savedFiles())[name] : undefined;
  if (text === undefined) throw new Error('Project was not saved');
  return text;
}
