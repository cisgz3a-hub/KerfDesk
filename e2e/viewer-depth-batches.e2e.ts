import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/kerfdesk-test';

type Fixture = typeof import('./fixtures/playback-stroke-viewer');
type Options = Parameters<Fixture['playbackStrokeFrame']>[0];

type Input = Pick<
  Options,
  | 'text'
  | 'segmentIndex'
  | 'point'
  | 'sample'
  | 'samples'
  | 'cameraTarget'
  | 'cameraPose'
  | 'clipMinX'
  | 'completedWidth'
> & { name: string; expected?: 'hidden' };

const cases: Input[] = [
  {
    name: 'sloping-retrace',
    text: 'G21 G90\nM3 S500\nG1 X100 Z10 F600\nG1 X0 Z0\nM5\nG0 X150 Z11',
    segmentIndex: 1,
    point: { x: 50, y: 0, z: 5 },
    sample: { x: 75, y: 0, z: 7.5 },
    samples: Array.from({ length: 41 }, (_, index) => ({
      x: 65 + index * 0.5,
      y: 0,
      z: 6.5 + index * 0.05,
    })),
    cameraTarget: { x: 50, y: 0, z: 5 },
    cameraPose: { x: 100, y: -100, z: 30 },
  },
  {
    name: 'flat-then-ramp',
    text: 'G21 G90\nG0 X0 Y50 Z0\nM3 S500\nG1 X100 F600\nM5\nG0 X50 Y0 Z-5\nM3 S500\nG1 Y100 Z5\nM5\nG0 X150 Y150 Z10',
    segmentIndex: 4,
    point: { x: 140, y: 140, z: 9 },
    sample: { x: 50, y: 50, z: 0 },
    samples: Array.from({ length: 41 }, (_, index) => ({ x: 45 + index * 0.25, y: 50, z: 0 })),
    cameraTarget: { x: 50, y: 50, z: 0 },
    cameraPose: { x: 100, y: -50, z: 25 },
  },
  {
    name: 'ramp-then-flat',
    text: 'G21 G90\nG0 X50 Y0 Z-5\nM3 S500\nG1 Y100 Z5 F600\nM5\nG0 X0 Y50 Z0\nM3 S500\nG1 X100\nM5\nG0 X150 Y150 Z10',
    segmentIndex: 4,
    point: { x: 140, y: 130, z: 8 },
    sample: { x: 50, y: 50, z: 0 },
    samples: Array.from({ length: 41 }, (_, index) => ({ x: 45 + index * 0.25, y: 50, z: 0 })),
    cameraTarget: { x: 50, y: 50, z: 0 },
    cameraPose: { x: 100, y: -50, z: 25 },
  },
];

const retrace = cases[0];
if (retrace === undefined) throw new Error('Missing sloping retrace input');
cases.splice(1, 0, {
  ...retrace,
  name: 'sloping-rapid-retrace',
  text: 'G21 G90\nM3 S500\nG1 X100 Z10 F600\nM5\nG0 X0 Z0',
});
cases.push({
  ...retrace,
  name: 'clipped-sloping-retrace',
  clipMinX: 75,
  samples: Array.from({ length: 41 }, (_, index) => ({
    x: 77 + index * 0.5,
    y: 0,
    z: 7.7 + index * 0.05,
  })),
});
cases.push({
  ...retrace,
  name: 'clipped-hidden-sloping-retrace',
  expected: 'hidden',
  clipMinX: 75,
  samples: Array.from({ length: 41 }, (_, index) => ({
    x: 50 + index * 0.5,
    y: 0,
    z: 5 + index * 0.05,
  })),
});
cases.push({ ...retrace, name: 'wide-sloping-retrace', completedWidth: 6 });
for (const sign of [-1, 1]) {
  cases.push({
    name: 'active-ramp-over-flat-' + sign,
    text: `G21 G90\nG0 X0 Y50 Z0\nM3 S500\nG1 X100 F600\nM5\nG0 X50 Y0 Z${-5 * sign}\nM3 S500\nG1 Y100 Z${5 * sign}`,
    segmentIndex: 3,
    point: { x: 50, y: 75, z: 2.5 * sign },
    sample: { x: 50, y: 50, z: 0 },
    samples: Array.from({ length: 41 }, (_, index) => ({
      x: 50,
      y: 25 + index,
      z: sign * (-2.5 + index * 0.1),
    })),
    cameraTarget: { x: 50, y: 50, z: 0 },
    cameraPose: { x: 100, y: -50, z: 25 },
  });
  cases.push({
    name: 'active-flat-over-ramp-' + sign,
    text: `G21 G90\nG0 X50 Y0 Z${-5 * sign}\nM3 S500\nG1 Y100 Z${5 * sign} F600\nM5\nG0 X0 Y50 Z0\nM3 S500\nG1 X100`,
    segmentIndex: 3,
    point: { x: 75, y: 50, z: 0 },
    sample: { x: 50, y: 50, z: 0 },
    samples: Array.from({ length: 41 }, (_, index) => ({ x: 45 + index * 0.25, y: 50, z: 0 })),
    cameraTarget: { x: 50, y: 50, z: 0 },
    cameraPose: { x: 100, y: -50, z: 25 },
  });
}

test('source-order strokes match an unculled ghost reference at sloping retraces and crossings', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const results = [];
  for (const input of cases)
    for (const look of ['classic', 'studio'] as const)
      for (const pixelRatio of [1, 2]) {
        const pair = [];
        for (const sourceOrder of [false, true]) {
          const options: Options = {
            ...input,
            sourceOrder,
            look,
            pixelRatio,
            perspective: true,
            vertical: false,
            viewport: { width: 800, height: 600 },
            cameraFar: 100_000,
            cameraUp: { x: 0, y: 0, z: 1 },
          };
          const rendered = await page.evaluate(async (value) => {
            const path = '/e2e/fixtures/playback-stroke-viewer.ts';
            const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
            const frame = fixture.playbackStrokeFrame(value);
            return {
              data: frame.data,
              regions: frame.regions,
              completedWidths: frame.completedWidths,
              pixels: await fixture.strokeRegionsColours(frame.data, frame.regions),
            };
          }, options);
          const name = `${input.name}-${look}-${pixelRatio}-${sourceOrder}`;
          const path = info.outputPath(name + '.png');
          await writeFile(
            path,
            Buffer.from(rendered.data.slice(rendered.data.indexOf(',') + 1), 'base64'),
          );
          await info.attach(name, { path, contentType: 'image/png' });
          pair.push({
            name,
            regions: rendered.regions,
            pixels: rendered.pixels,
            completedWidths: rendered.completedWidths,
          });
        }
        results.push(pair);
        await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(results, null, 2));
        const [fast, reference] = pair;
        if (fast === undefined || reference === undefined) throw new Error('Missing matched frame');
        if (input.completedWidth !== undefined)
          for (const rendered of pair) {
            expect(rendered.completedWidths.length, rendered.name).toBeGreaterThan(0);
            expect(
              rendered.completedWidths.every((width) => width === input.completedWidth),
              rendered.name,
            ).toBe(true);
          }
        expect(fast.regions).toEqual(reference.regions);
        expect(fast.pixels.total, fast.name).toBeGreaterThan(30);
        for (const rendered of pair) {
          if (input.expected === 'hidden') {
            expect(rendered.pixels.cut + rendered.pixels.white, rendered.name).toBe(0);
          } else {
            expect(
              rendered.pixels.cut + rendered.pixels.white,
              rendered.name,
            ).toBeGreaterThanOrEqual(rendered.pixels.total * 0.95);
          }
          if (input.name.includes('sloping') && input.expected !== 'hidden')
            expect(rendered.pixels.white, rendered.name).toBe(rendered.pixels.total);
        }
        expect(fast.pixels).toEqual(reference.pixels);
      }
  await writeFile(info.outputPath('pixel-samples.json'), JSON.stringify(results, null, 2));
});

test('a partial sloping ghost preserves its future tail without tinting the core or playhead cap', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const results = [];
  for (const sign of [-1, 1])
    for (const look of ['classic', 'studio'] as const)
      for (const pixelRatio of [1, 2])
        for (const sourceOrder of [false, true])
          for (const ended of [false, true]) {
            const points = (start: number, step: number) =>
              Array.from({ length: 41 }, (_, index) => {
                const x = start + index * step;
                return { x, y: 0, z: x * 0.1 * sign };
              });
            const prefix = points(15, 0.5);
            const future = points(65, 0.5);
            const tip = points(46, 0.1);
            const options: Options = {
              text: `G21 G90\nM3 S500\nG1 X100 Z${10 * sign} F600`,
              segmentIndex: 0,
              point: { x: ended ? 100 : 50, y: 0, z: (ended ? 10 : 5) * sign },
              sample: { x: 15, y: 0, z: 1.5 * sign },
              samples: [...prefix, ...future, ...tip],
              look,
              pixelRatio,
              sourceOrder,
              perspective: true,
              vertical: false,
              viewport: { width: 800, height: 600 },
              cameraFar: 100_000,
              cameraUp: { x: 0, y: 0, z: 1 },
              cameraPose: { x: 100, y: -130, z: 30 },
              cameraTarget: { x: 50, y: 0, z: 5 * sign },
            };
            const rendered = await page.evaluate(async (value) => {
              const path = '/e2e/fixtures/playback-stroke-viewer.ts';
              const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
              const frame = fixture.playbackStrokeFrame(value);
              const image = new Image();
              image.src = frame.data;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d');
              if (context === null) throw new Error('Screenshot decoder unavailable');
              context.drawImage(image, 0, 0);
              const samples = (from: number) => {
                const distinct = new Map(
                  frame.regions.slice(from, from + 41).map((r) => [JSON.stringify(r), r]),
                );
                return [...distinct.values()].map((r) => ({
                  region: r,
                  rgba: [...context.getImageData(r.x, r.y, 1, 1).data],
                }));
              };
              // Pure white is expected only where every MSAA sample is inside
              // the four-CSS-pixel core. Preserve edge samples separately.
              const modulesPath = '/src/ui/viewer3d/viewer3d-modules.ts';
              const modules = (await import(
                /* @vite-ignore */ modulesPath
              )) as typeof import('../src/ui/viewer3d/viewer3d-modules');
              const { three } = await modules.loadThree();
              const camera = new three.PerspectiveCamera(40, 4 / 3, 0.1, 100_000);
              camera.up.set(0, 0, 1);
              const pose = value.cameraPose;
              const target = value.cameraTarget;
              const pixelRatio = value.pixelRatio;
              if (!pose || !target || pixelRatio === undefined)
                throw new Error('Missing fixed cap camera');
              camera.position.set(pose.x, pose.y, pose.z);
              camera.lookAt(target.x, target.y, target.z);
              camera.updateMatrixWorld();
              const project = (point: { x: number; y: number; z: number }) => {
                const p = new three.Vector3(point.x, point.y, point.z).project(camera);
                return { x: ((p.x + 1) * canvas.width) / 2, y: ((1 - p.y) * canvas.height) / 2 };
              };
              const a = project({ x: 0, y: 0, z: 0 });
              const b = project(value.point);
              const dx = b.x - a.x,
                dy = b.y - a.y;
              const covered = (x: number, y: number) => {
                const t = Math.max(
                  0,
                  Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)),
                );
                return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) < 2 * pixelRatio;
              };
              const tipBoundary = samples(82);
              const tipRegions = new Map(
                tipBoundary.map((sample) => [JSON.stringify(sample.region), sample.region]),
              );
              for (const x of [Math.floor(b.x) - 1, Math.floor(b.x)])
                for (const y of [Math.floor(b.y) - 1, Math.floor(b.y)]) {
                  const region = { x, y, width: 1, height: 1 };
                  tipRegions.set(JSON.stringify(region), region);
                }
              const tip = [...tipRegions.values()]
                .filter(
                  (r) =>
                    covered(r.x, r.y) &&
                    covered(r.x + 1, r.y) &&
                    covered(r.x, r.y + 1) &&
                    covered(r.x + 1, r.y + 1),
                )
                .map((r) => ({ region: r, rgba: [...context.getImageData(r.x, r.y, 1, 1).data] }));
              for (const sample of tip)
                if (
                  sample.region.x < 0 ||
                  sample.region.y < 0 ||
                  sample.region.x >= canvas.width ||
                  sample.region.y >= canvas.height
                )
                  throw new Error('Core cap sample outside the rendered viewport');
              return {
                data: frame.data,
                prefix: samples(0),
                future: samples(41),
                tip,
                tipBoundary,
                coreSegment: [a, b],
                coreRadiusPixels: 2 * pixelRatio,
              };
            }, options);
            const name = `tail-${sign}-${look}-${pixelRatio}-${sourceOrder}-${ended}`;
            const path = info.outputPath(name + '.png');
            await writeFile(
              path,
              Buffer.from(rendered.data.slice(rendered.data.indexOf(',') + 1), 'base64'),
            );
            const pixels = {
              prefix: rendered.prefix,
              future: rendered.future,
              tip: rendered.tip,
              tipBoundary: rendered.tipBoundary,
              coreSegment: rendered.coreSegment,
              coreRadiusPixels: rendered.coreRadiusPixels,
            };
            results.push({ name, ...pixels });
            await writeFile(
              info.outputPath('tail-pixel-samples.json'),
              JSON.stringify(results, null, 2),
            );
            await info.attach(name, { path, contentType: 'image/png' });
            const white = (sample: { rgba: number[] }) =>
              sample.rgba.slice(0, 3).every((channel) => channel > 230);
            const blue = (sample: { rgba: number[] }) => {
              const [r = 0, g = 0, b = 0] = sample.rgba;
              return b > r + 5 && b > g + 3;
            };
            expect(rendered.prefix.length, name).toBeGreaterThan(30);
            expect(rendered.future.length, name).toBeGreaterThan(30);
            expect(rendered.tip.length, name).toBeGreaterThan(3);
            expect(rendered.prefix.every(white), name + ' white prefix').toBe(true);
            expect(rendered.tip.every(white), name + ' white cap').toBe(true);
            if (ended) expect(rendered.future.every(white), name + ' complete core').toBe(true);
            else
              expect(
                rendered.future.filter(blue).length,
                name + ' faint future tail',
              ).toBeGreaterThanOrEqual(rendered.future.length * 0.95);
          }
});
