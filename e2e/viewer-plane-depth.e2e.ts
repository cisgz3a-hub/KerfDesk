import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures/kerfdesk-test';

type StrokeFixture = typeof import('./fixtures/playback-stroke-viewer');
type Options = Parameters<StrokeFixture['playbackStrokeFrame']>[0];

const retrace = {
  text: 'G21 G90\nM3 S500\nG1 X100 F600\nG1 X0\nM5\nG0 Z1',
  segmentIndex: 1,
  point: { x: 50, y: 0, z: 0 },
  sample: { x: 75, y: 0, z: 0 },
  samples: Array.from({ length: 41 }, (_, index) => ({ x: 65 + index * 0.5, y: 0, z: 0 })),
  cameraPose: { x: 100, y: -100, z: 25 },
  cameraTarget: { x: 50, y: 0, z: 0 },
  cameraUp: { x: 0, y: 0, z: 1 },
  cameraFar: 100_000,
  viewport: { width: 800, height: 600 },
  vertical: false,
};

async function frame(page: Page, info: TestInfo, name: string, options: Options) {
  const result = await page.evaluate(async (value) => {
    const path = '/e2e/fixtures/playback-stroke-viewer.ts';
    const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
    const rendered = fixture.playbackStrokeFrame(value);
    return {
      data: rendered.data,
      regions: rendered.regions,
      pixels: await fixture.strokeRegionsColours(rendered.data, rendered.regions),
    };
  }, options);
  const path = info.outputPath(name + '.png');
  await writeFile(path, Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'));
  await info.attach(name, { path, contentType: 'image/png' });
  return { name, regions: result.regions, ...result.pixels };
}

test('future Z parking keeps the exact reviewed retrace visible at DPR 1 and 2', async ({
  page,
}, info) => {
  await page.goto('/');
  const results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true])
      for (const pixelRatio of [1, 2])
        for (const hideCompleted of [false, true]) {
          const name = `future-z-${look}-${perspective}-${pixelRatio}-${hideCompleted}`;
          const result = await frame(page, info, name, {
            ...retrace,
            look,
            perspective,
            pixelRatio,
            hideCompleted,
          });
          results.push(result);
          expect(result.total, name).toBeGreaterThan(30);
          expect(result.cut, name).toBe(0);
          expect(result.white, name).toBeGreaterThanOrEqual(result.total * 0.95);
        }
  await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(results, null, 2));
});

test('mixed-Z playback retains genuine nearer and farther completed-cut depth', async ({
  page,
}, info) => {
  await page.goto('/');
  const results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true])
      for (const pixelRatio of [1, 2])
        for (const z of [-1, 1]) {
          const name = `cut-depth-${look}-${perspective}-${pixelRatio}-${z}`;
          const result = await frame(page, info, name, {
            text: `G21 G90\nG0 X0 Y50 Z${z}\nM3 S500\nG1 X100 F600\nM5\nG0 Z0\nM3 S500\nG1 X0`,
            segmentIndex: 3,
            point: { x: 50, y: 50, z: 0 },
            sample: { x: 75, y: 50, z: 0 },
            samples: Array.from({ length: 41 }, (_, index) => ({
              x: 55 + index * 0.5,
              y: 50,
              z: 0,
            })),
            cameraPose: { x: 50, y: 50 - 110 * 0.0008, z: 110 },
            cameraUp: { x: 0, y: 0, z: 1 },
            cameraFar: 100_000,
            cameraTarget: { x: 50, y: 50, z: 0 },
            vertical: false,
            look,
            perspective,
            pixelRatio,
          });
          results.push(result);
          expect(result.total, name).toBeGreaterThan(25);
          expect(z > 0 ? result.cut : result.white, name).toBeGreaterThanOrEqual(
            result.total * 0.95,
          );
          expect(z > 0 ? result.white : result.cut, name).toBe(0);
        }
  await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(results, null, 2));
});

test('mixed-Z strokes remain occluded by nearer opaque scene geometry', async ({ page }, info) => {
  await page.goto('/');
  const results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true])
      for (const pixelRatio of [1, 2]) {
        const name = `scene-depth-${look}-${perspective}-${pixelRatio}`;
        const result = await frame(page, info, name, {
          ...retrace,
          look,
          perspective,
          pixelRatio,
          occluderZ: 1,
        });
        results.push(result);
        expect(result.white, name).toBe(0);
        expect(result.cut, name).toBe(0);
        expect(result.occluder, name).toBe(result.total);
      }
  await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(results, null, 2));
});
