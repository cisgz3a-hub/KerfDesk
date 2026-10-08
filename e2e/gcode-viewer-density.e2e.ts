import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';

type Fixture = typeof import('./fixtures/dense-laser-viewer');
const fixturePath = '/e2e/fixtures/dense-laser-viewer.tsx';

async function mount(page: Page, text?: string): Promise<Locator> {
  await page.goto('/');
  await expect(
    page.locator('meta[name="kerfdesk-build-capabilities"]'),
    'The real Inspector must run in desktop mode, where its Pro component is retained.',
  ).toHaveAttribute('content', 'desktop');
  const welcome = page.getByRole('button', { name: 'Continue with Free', exact: true });
  if (await welcome.isVisible()) await welcome.click();
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  const segments = await page.evaluate(
    async ({ path, text }) => {
      const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
      return fixture.mountLaserViewer(text ?? fixture.denseLaserProgram());
    },
    { path: fixturePath, text },
  );
  if (text === undefined) expect(segments).toBeGreaterThan(367_000);
  const view = page.locator('#density-viewer-fixture');
  await expect(view.locator('[data-viewer-state="ready"]')).toBeVisible({ timeout: 90_000 });
  await view.getByRole('button', { name: 'Top', exact: true }).click();
  await page.waitForTimeout(700);
  await page.mouse.move(0, 0);
  return view;
}

async function colours(
  page: Page,
  canvas: Locator,
  path?: string,
): Promise<{ red: number; cut: number }> {
  const png = await canvas.screenshot(path === undefined ? {} : { path });
  return page.evaluate(
    async ({ path, data }) => {
      const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
      return fixture.screenshotColours(data);
    },
    { path: fixturePath, data: png.toString('base64') },
  );
}

test('dense laser artwork remains readable with traversal shown in both looks', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  const view = await mount(page);
  const canvas = view.getByLabel('3D G-code toolpath', { exact: true });
  const travel = view.getByRole('checkbox', { name: 'Travel', exact: true });
  await canvas.screenshot({ path: info.outputPath('dense-laser-initial.png') });
  await expect(travel).not.toBeChecked();
  await expect(view.getByLabel('Colour lens')).toHaveValue('kind');
  const clean = await colours(page, canvas);
  expect(clean.cut).toBeGreaterThan(2_000);
  await travel.check();
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: info.outputPath('dense-laser-travel.png') });
  const shown = await colours(page, canvas);
  expect(shown.cut).toBeGreaterThan(clean.cut * 0.8);
  expect(shown.red).toBeLessThan(clean.cut);
  await view.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: info.outputPath('dense-laser-studio.png') });
  const studio = await colours(page, canvas);
  expect(studio.cut).toBeGreaterThan(clean.cut * 0.7);
  expect(studio.red).toBeLessThan(clean.cut);
  await view.getByRole('button', { name: 'Classic', exact: true }).click();
  await expect(travel).toBeChecked();
  await view.getByRole('button', { name: 'Iso', exact: true }).click();
  await page.waitForTimeout(700);
  const isoTravel = await colours(page, canvas, info.outputPath('dense-laser-iso-travel.png'));
  await travel.uncheck();
  await page.waitForTimeout(250);
  const isoClean = await colours(page, canvas, info.outputPath('dense-laser-iso-initial.png'));
  expect(isoTravel.cut).toBeGreaterThanOrEqual(isoClean.cut * 0.9);
  expect(isoTravel.red).toBeLessThan(isoClean.cut);
  expect(problems).toEqual([]);
});

test('coplanar traversal cannot repaint a completed cut', async ({ page }, info) => {
  const view = await mount(page, 'G21 G90\nM4 S500\nG0 X0 Y50\nG1 X100 F3000\nG0 X0\nM5');
  const canvas = view.getByLabel('3D G-code toolpath', { exact: true });
  const before = await colours(page, canvas, info.outputPath('coplanar-before.png'));
  await view.getByRole('checkbox', { name: 'Travel', exact: true }).check();
  await page.waitForTimeout(200);
  const after = await colours(page, canvas, info.outputPath('coplanar-after.png'));
  expect(before.cut).toBeGreaterThan(100);
  expect(after.cut).toBeGreaterThanOrEqual(before.cut * 0.98);
  await view.getByLabel('Colour lens').selectOption('depth');
  await expect(view).toContainText('Single cutting depth: 0.00 mm');
});

type StrokeFixture = typeof import('./fixtures/playback-stroke-viewer');

test('active playback stays in front of coplanar retraces and crossings', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.goto('/');
  const cases = [
    {
      name: 'retrace',
      text: 'G21 G90\nM4 S500\nG0 X0 Y50\nG1 X100 F3000\nG1 X0\nM5',
      segmentIndex: 2,
      point: { x: 50, y: 50, z: 0 },
      sample: { x: 75, y: 50, z: 0 },
      vertical: false,
    },
    {
      name: 'crossing',
      text: 'G21 G90\nM4 S500\nG0 X0 Y50\nG1 X100 F3000\nG0 X75 Y65\nG1 Y15\nM5',
      segmentIndex: 3,
      point: { x: 75, y: 35, z: 0 },
      sample: { x: 75, y: 50, z: 0 },
      vertical: true,
    },
  ];
  for (const scenario of cases) {
    for (const look of ['classic', 'studio'] as const) {
      for (const perspective of [false, true]) {
        for (const view of ['top', 'iso', 'x-angle', 'grazing'] as const) {
          const result = await page.evaluate(
            async (options) => {
              const path = '/e2e/fixtures/playback-stroke-viewer.ts';
              const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
              const frame = fixture.playbackStrokeFrame(options);
              return {
                data: frame.data,
                pixels: await fixture.strokeRegionColours(frame.data, frame.region),
              };
            },
            { ...scenario, look, perspective, view },
          );
          const name = `${scenario.name}-${look}-${view}-${perspective ? 'perspective' : 'ortho'}`;
          const path = info.outputPath(name + '.png');
          await writeFile(
            path,
            Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'),
          );
          await info.attach(name, { path, contentType: 'image/png' });
          expect(
            result.pixels.cut,
            `${name}: completed cuts must not leak through the active core`,
          ).toBe(0);
          expect(
            result.pixels.white,
            `${name}: the active core must remain visible`,
          ).toBeGreaterThanOrEqual(result.pixels.total * 0.95);
        }
      }
    }
  }
});

test('playback depth testing retains occlusion by a nearer cutting plane', async ({
  page,
}, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/e2e/fixtures/playback-stroke-viewer.ts';
    const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
    const frame = fixture.playbackStrokeFrame({
      text: 'G21 G90\nM4 S500\nG0 X0 Y50 Z1\nG1 X100 F3000\nG0 Z0\nG1 X0\nM5',
      segmentIndex: 3,
      point: { x: 50, y: 50, z: 0 },
      sample: { x: 75, y: 50, z: 0 },
      vertical: false,
      look: 'classic',
      perspective: false,
    });
    return {
      data: frame.data,
      pixels: await fixture.strokeRegionColours(frame.data, frame.region),
    };
  });
  const path = info.outputPath('nearer-cutting-plane.png');
  await writeFile(path, Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'));
  await info.attach('nearer-cutting-plane', { path, contentType: 'image/png' });
  expect(result.pixels.cut).toBeGreaterThan(result.pixels.total * 0.5);
});

test('planar playback remains occluded by nearer scene geometry', async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.goto('/');
  for (const look of ['classic', 'studio'] as const) {
    for (const perspective of [false, true]) {
      for (const view of ['top', 'iso', 'x-angle', 'grazing'] as const) {
        const result = await page.evaluate(
          async (options) => {
            const path = '/e2e/fixtures/playback-stroke-viewer.ts';
            const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
            const frame = fixture.playbackStrokeFrame({
              text: 'G21 G90\nM4 S500\nG0 X0 Y50\nG1 X100 F3000\nG0 X75 Y65\nG1 Y15\nM5',
              segmentIndex: 3,
              point: { x: 75, y: 35, z: 0 },
              sample: { x: 75, y: 50, z: 0 },
              vertical: true,
              occluderZ: 1,
              ...options,
            });
            return {
              data: frame.data,
              pixels: await fixture.strokeRegionColours(frame.data, frame.region),
            };
          },
          { look, perspective, view },
        );
        const name =
          'scene-occlusion-' + look + '-' + view + '-' + (perspective ? 'perspective' : 'ortho');
        const path = info.outputPath(name + '.png');
        await writeFile(
          path,
          Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'),
        );
        await info.attach(name, { path, contentType: 'image/png' });
        expect(
          result.pixels.white,
          name + ': nearer scene geometry must hide the active core',
        ).toBe(0);
        expect(result.pixels.cut, name + ': nearer scene geometry must hide completed cuts').toBe(
          0,
        );
        expect(result.pixels.occluder, name + ': the opaque scene plane must remain visible').toBe(
          result.pixels.total,
        );
      }
    }
  }
});

test('live-position marker remains red above completed and active planar strokes', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.goto('/');
  for (const look of ['classic', 'studio'] as const) {
    for (const perspective of [false, true]) {
      for (const view of ['top', 'iso', 'x-angle', 'grazing'] as const) {
        const result = await page.evaluate(
          async (options) => {
            const path = '/e2e/fixtures/playback-stroke-viewer.ts';
            const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
            const frame = fixture.playbackStrokeFrame({
              text: 'G21 G90\nM4 S500\nG0 X0 Y50\nG1 X100 F3000\nG0 X75 Y65\nG1 Y15\nM5',
              segmentIndex: 3,
              point: { x: 75, y: 35, z: 0 },
              sample: { x: 75, y: 50, z: 0 },
              vertical: true,
              liveMarker: true,
              ...options,
            });
            return {
              data: frame.data,
              pixels: await fixture.strokeRegionColours(frame.data, frame.region),
            };
          },
          { look, perspective, view },
        );
        const name =
          'live-marker-' + look + '-' + view + '-' + (perspective ? 'perspective' : 'ortho');
        const path = info.outputPath(name + '.png');
        await writeFile(
          path,
          Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'),
        );
        await info.attach(name, { path, contentType: 'image/png' });
        expect(result.pixels.live, name + ': live marker must retain its exact red colour').toBe(
          result.pixels.total,
        );
      }
    }
  }
});

test('Studio origin arrows and dot remain above planar playback', async ({ page }, info) => {
  await page.goto('/');
  for (const scenario of [
    { sample: { x: 5, y: 0, z: 0 }, kind: 'axis', liveMarker: false },
    { sample: { x: 0, y: 0, z: 0 }, kind: 'origin', liveMarker: false },
    { sample: { x: 0, y: 0, z: 0 }, kind: 'live', liveMarker: true },
  ] as const) {
    for (const hideToolpath of [true, false]) {
      const result = await page.evaluate(
        async (options) => {
          const path = '/e2e/fixtures/playback-stroke-viewer.ts';
          const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
          const frame = fixture.playbackStrokeFrame({
            text: 'G21 G90\nM4 S500\nG0 X0 Y-10\nG0 X-50 Y0\nG1 X50 F3000\nG1 X-50\nM5',
            segmentIndex: 3,
            point: { x: -10, y: 0, z: 0 },
            vertical: false,
            look: 'studio',
            perspective: false,
            studioFurniture: true,
            ...options,
          });
          return {
            data: frame.data,
            pixels: await fixture.strokeRegionColours(frame.data, frame.region),
          };
        },
        { ...scenario, hideToolpath },
      );
      const kind = scenario.kind;
      const name = 'studio-' + kind + '-' + (hideToolpath ? 'baseline' : 'playback');
      const path = info.outputPath(name + '.png');
      await writeFile(path, Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'));
      await info.attach(name, { path, contentType: 'image/png' });
      expect(result.pixels[kind], name + ': triad must retain its exact foreground colour').toBe(
        result.pixels.total,
      );
    }
  }
});
