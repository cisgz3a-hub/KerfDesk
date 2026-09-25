import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/kerfdesk-test';
import { clearCanvasProject } from './fixtures/mixed-canvas-project';
import {
  composedSvgSnapshot,
  delaySecondSvgBitmap,
  exportComposedSvg,
  importComposedSvg,
  svgRedo,
  svgUndo,
} from './fixtures/composed-svg-browser';
import { compareNativeSvg } from './fixtures/composed-svg-native-render';
import { captureSvgCanvas, compareClippedCanvas } from './fixtures/composed-svg-canvas';
import { composedSvgImportStages } from './fixtures/composed-svg-fit';
import { toolbarCommand } from './fixtures/workspace-ui';

const fixtures = [
  { name: 'composition-mixed.svg', objects: 4, images: 2, shouldFit: true },
  { name: 'composition-clipped-image.svg', objects: 1, images: 1, shouldFit: false },
  { name: 'composition-visible-mask.svg', objects: 5, images: 2, shouldFit: true },
] as const;

function fixtureText(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/composed-svg/${name}`, import.meta.url)),
    'utf8',
  );
}

for (const fixture of fixtures) {
  test(`composed SVG picker/export/re-import preserves rendered geometry: ${fixture.name}`, async ({
    page,
    kerfdesk,
  }, info) => {
    test.setTimeout(120_000);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    const source = fixtureText(fixture.name);
    await importComposedSvg(page, kerfdesk, fixture.name, source, fixture.objects);
    await page.screenshot({ path: info.outputPath('workspace-initial-import.png') });
    const { inserted, authored } = await composedSvgImportStages(
      page,
      fixture.objects,
      fixture.shouldFit,
    );
    expect(
      inserted.project.scene.objects.filter((object) => object.kind === 'raster-image'),
    ).toHaveLength(fixture.images);
    expect(workers.some((url) => url.includes('document-import-worker'))).toBe(true);
    const exported = await exportComposedSvg(page, kerfdesk);
    const native = await compareNativeSvg(page, source, exported);
    expect(native.exportedViewBox[2]).toBeCloseTo(Number(native.sourceViewBox[2]), 7);
    expect(native.exportedViewBox[3]).toBeCloseTo(Number(native.sourceViewBox[3]), 7);
    expect(native.paintedPixels).toBeGreaterThan(100);
    expect(native.changedFraction).toBeLessThan(0.0001);
    writeFileSync(info.outputPath('exported.svg'), exported);
    writeFileSync(
      info.outputPath('imported-project.json'),
      JSON.stringify(inserted.project, null, 2),
    );
    writeFileSync(
      info.outputPath('authored-project.json'),
      JSON.stringify(authored.project, null, 2),
    );
    writeFileSync(info.outputPath('worker-urls.json'), JSON.stringify(workers, null, 2));
    writeFileSync(
      info.outputPath('native-source.png'),
      Buffer.from(native.sourcePng.slice(native.sourcePng.indexOf(',') + 1), 'base64'),
    );
    writeFileSync(
      info.outputPath('native-export.png'),
      Buffer.from(native.exportedPng.slice(native.exportedPng.indexOf(',') + 1), 'base64'),
    );
    await page.screenshot({ path: info.outputPath('workspace-import.png') });
    const painted = await captureSvgCanvas(page, authored.project);
    await svgUndo(page, 0);
    expect((await composedSvgSnapshot(page)).undoCount).toBe(0);
    const raster = authored.project.scene.objects[0];
    if (fixture.name === 'composition-clipped-image.svg' && raster?.kind === 'raster-image') {
      const empty = await captureSvgCanvas(page, authored.project);
      const samples = await compareClippedCanvas(page, source, raster, painted, empty);
      writeFileSync(info.outputPath('canvas-pixels.json'), JSON.stringify(samples, null, 2));
      for (const sample of samples)
        expect(sample.maxDifference, sample.name).toBeLessThanOrEqual(16);
    }
    await svgRedo(page, fixture.objects);
    expect((await composedSvgSnapshot(page)).project).toEqual(authored.project);
    if (fixture.shouldFit) {
      await svgRedo(page, fixture.objects);
      expect((await composedSvgSnapshot(page)).project).toEqual(inserted.project);
    }
    await clearCanvasProject(page);
    await importComposedSvg(page, kerfdesk, 'roundtrip.svg', exported, fixture.objects);
    const { authored: reimported } = await composedSvgImportStages(
      page,
      fixture.objects,
      fixture.shouldFit,
    );
    expect(reimported.project.scene.objects.map((object) => object.kind)).toEqual(
      inserted.project.scene.objects.map((object) => object.kind),
    );
    const repeated = await exportComposedSvg(page, kerfdesk);
    const again = await compareNativeSvg(page, exported, repeated);
    expect(again.changedFraction).toBeLessThan(0.0001);
    await page.screenshot({ path: info.outputPath('workspace-reimport.png') });
    writeFileSync(
      info.outputPath('render-metrics.json'),
      JSON.stringify(
        {
          first: { ...native, sourcePng: undefined, exportedPng: undefined },
          repeated: { ...again, sourcePng: undefined, exportedPng: undefined },
        },
        null,
        2,
      ),
    );
    expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual(
      [],
    );
  });
}

test('Esc during second SVG bitmap hydration cancels the whole file and leaves Undo untouched', async ({
  page,
  kerfdesk,
}) => {
  await delaySecondSvgBitmap(page);
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'cancelled-composition.svg', text: fixtureText('composition-mixed.svg') },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __svgDecodeGate?: { held: boolean } }).__svgDecodeGate?.held ??
          false,
      ),
    )
    .toBe(true);
  expect((await composedSvgSnapshot(page)).project.scene.objects).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    (window as Window & { __svgDecodeGate?: { release: () => void } }).__svgDecodeGate?.release(),
  );
  await expect(
    page.getByText('Warning: cancelled-composition.svg: import cancelled.', { exact: true }),
  ).toBeVisible();
  const cancelled = await composedSvgSnapshot(page);
  expect(cancelled.project.scene.objects).toHaveLength(0);
  expect(cancelled.undoCount).toBe(0);
  await importComposedSvg(
    page,
    kerfdesk,
    'replacement.svg',
    fixtureText('composition-mixed.svg'),
    4,
  );
  const { authored } = await composedSvgImportStages(page, 4, true);
  expect(authored.undoCount).toBe(1);
  await svgUndo(page, 0);
  expect((await kerfdesk.events()).filter((event) => event.kind.startsWith('serial-'))).toEqual([]);
});
