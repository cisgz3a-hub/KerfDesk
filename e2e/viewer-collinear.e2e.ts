import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/kerfdesk-test';

type StrokeFixture = typeof import('./fixtures/playback-stroke-viewer');

const cases = [
  {
    name: 'horizontal',
    segmentIndex: 1,
    text: 'G21 G90\nM3 S500\nG1 X100 F600\nG1 X0',
    point: { x: 50, y: 0, z: 0 },
    sample: { x: 75, y: 0, z: 0 },
    cameraPose: { x: 100, y: -100, z: 25 },
    cameraTarget: { x: 50, y: 0, z: 0 },
    vertical: false,
  },
  {
    name: 'vertical',
    segmentIndex: 1,
    text: 'G21 G90\nM3 S500\nG1 Y100 F600\nG1 Y0',
    point: { x: 0, y: 50, z: 0 },
    sample: { x: 0, y: 75, z: 0 },
    cameraPose: { x: 100, y: 100, z: 25 },
    cameraTarget: { x: 0, y: 50, z: 0 },
    vertical: true,
  },
  {
    name: 'near-flat',
    segmentIndex: 1,
    text: 'G21 G90\nM3 S500\nG1 X100 Z0.0005 F600\nG1 X0 Z0',
    point: { x: 50, y: 0, z: 0.00025 },
    sample: { x: 75, y: 0, z: 0.000375 },
    cameraPose: { x: 100, y: -100, z: 25 },
    cameraTarget: { x: 50, y: 0, z: 0 },
    vertical: false,
  },
  {
    name: 'future-z-parking',
    segmentIndex: 1,
    text: 'G21 G90\nM3 S500\nG1 X100 F600\nG1 X0\nM5\nG0 Z1',
    point: { x: 50, y: 0, z: 0 },
    sample: { x: 75, y: 0, z: 0 },
    cameraPose: { x: 100, y: -100, z: 25 },
    cameraTarget: { x: 50, y: 0, z: 0 },
    vertical: false,
  },
  {
    name: 'future-z-cut',
    segmentIndex: 1,
    text: 'G21 G90\nM3 S500\nG1 Y100 F600\nG1 Y0\nG1 Z1\nM5',
    point: { x: 0, y: 50, z: 0 },
    sample: { x: 0, y: 75, z: 0 },
    cameraPose: { x: 100, y: 100, z: 25 },
    cameraTarget: { x: 0, y: 50, z: 0 },
    vertical: true,
  },
  {
    name: 'past-z-cut',
    segmentIndex: 4,
    text: 'G21 G90\nG0 X0 Y100 Z1\nM3 S500\nG1 X100 F600\nM5\nG0 X0 Y0 Z0\nM3 S500\nG1 X100\nG1 X0',
    point: { x: 50, y: 0, z: 0 },
    sample: { x: 75, y: 0, z: 0 },
    cameraPose: { x: 100, y: -100, z: 25 },
    cameraTarget: { x: 50, y: 0, z: 0 },
    vertical: false,
  },
] as const;

for (const scenario of cases) {
  test(
    scenario.name + ' playback remains visible on a zero-area planar retrace',
    async ({ page }, info) => {
      test.setTimeout(150_000);
      await page.goto('/');
      const failures: string[] = [];
      const samples = [];
      for (const look of ['classic', 'studio'] as const) {
        for (const perspective of [false, true]) {
          // Preserve the released stroke width as well as the normal production width.
          // Hiding only completed geometry is a paired positive control at the same pose.
          for (const control of ['normal', 'wide-completed', 'hide-completed'] as const) {
            const result = await page.evaluate(
              async (options) => {
                const path = '/e2e/fixtures/playback-stroke-viewer.ts';
                const fixture = (await import(/* @vite-ignore */ path)) as StrokeFixture;
                const frame = fixture.playbackStrokeFrame(options);
                return {
                  data: frame.data,
                  regions: frame.regions,
                  pixels: await fixture.strokeRegionsColours(frame.data, frame.regions),
                };
              },
              {
                ...scenario,
                samples: Array.from({ length: 41 }, (_, index) => {
                  const coordinate = 55 + index * 0.5;
                  return {
                    x: scenario.vertical ? 0 : coordinate,
                    y: scenario.vertical ? coordinate : 0,
                    z: scenario.name === 'near-flat' ? coordinate * 0.000005 : 0,
                  };
                }),
                segmentIndex: scenario.segmentIndex,
                look,
                perspective,
                hideCompleted: control === 'hide-completed',
                ...(control === 'wide-completed' ? { completedWidth: 2.5 } : {}),
              },
            );
            const name =
              scenario.name +
              '-' +
              look +
              '-' +
              (perspective ? 'perspective' : 'ortho') +
              '-' +
              control;
            const path = info.outputPath(name + '.png');
            await writeFile(
              path,
              Buffer.from(result.data.slice(result.data.indexOf(',') + 1), 'base64'),
            );
            await info.attach(name, { path, contentType: 'image/png' });
            samples.push({ name, regions: result.regions, ...result.pixels });
            expect(
              result.pixels.total,
              'sample many distinct visible centreline pixels',
            ).toBeGreaterThan(25);
            if (result.pixels.cut !== 0 || result.pixels.white < result.pixels.total * 0.95)
              failures.push(name + ': ' + JSON.stringify(result.pixels));
          }
        }
      }
      await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(samples, null, 2));
      expect(failures, 'completed cuts must not leak through the active core').toEqual([]);
    },
  );
}
