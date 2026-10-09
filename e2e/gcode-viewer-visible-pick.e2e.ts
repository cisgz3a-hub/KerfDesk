import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { VisiblePickOptions } from './fixtures/visible-pick-viewer';

const CUT_TRAVEL = 'G21 G90\nM3 S500\nG1 X100 F600\nM5\nG1 X0\nG1 Y10';
const BEAM = 'G21 G90\nM3 S500\nG1 X100 F600';
type Frame = Awaited<ReturnType<typeof import('./fixtures/visible-pick-viewer').visiblePickFrame>>;

test('coplanar picks name the visible cut while genuine nearer travel retains depth priority', async ({
  page,
}, info) => {
  const errors = await openProbe(page);
  const results: { name: string; options: VisiblePickOptions; frame: Omit<Frame, 'data'> }[] = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true]) {
      for (const angle of ['top', 'iso', 'grazing'] as const) {
        for (const text of [CUT_TRAVEL, CUT_TRAVEL.replace('\nG1 Y10', '')]) {
          const options = {
            text,
            sample: { x: 50, y: 0, z: 0 },
            look,
            perspective,
            travel: true,
            angle,
            alignToPixelCentre: true,
          };
          const frame = await capture(page, info, options, results, 'coplanar-cut');
          const withoutTravel = await capture(
            page,
            info,
            { ...options, travel: false },
            results,
            'coplanar-cut-travel-off',
          );
          const intendedCut = look === 'classic' ? [151, 209, 255, 255] : [79, 163, 255, 255];
          expect(
            withoutTravel.pixel,
            'the aligned control pixel must contain the intended cut RGB',
          ).toEqual(intendedCut);
          expect(frame.pixel, 'Travel must not tint or replace the aligned cut pixel').toEqual(
            intendedCut,
          );
          expect(frame.pixel).toEqual(withoutTravel.pixel);
          expect(
            withoutTravel.pick?.segmentIndex,
            'Travel off must name the same visible cut',
          ).toBe(0);
          expect(frame.pick?.point.x).toBeCloseTo(50, 7);
          expect(withoutTravel.pick?.point.x).toBeCloseTo(50, 7);
          expect(
            frame.pick?.segmentIndex,
            'pick must name the blue cut rather than its travel retrace',
          ).toBe(0);
        }
      }
      await pickControls(page, info, look, perspective, results);
    }
  await saveResults(info, results);
  expect(errors).toEqual([]);
});

test('unrelated off-plane moves preserve the visible coplanar cut and its pick', async ({
  page,
}, info) => {
  const errors = await openProbe(page);
  const results: Results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true])
      for (const angle of ['top', 'iso', 'grazing'] as const)
        for (const pixelRatio of [1, 2] as const)
          for (const prefix of [CUT_TRAVEL, CUT_TRAVEL.replace('\nG1 Y10', '')])
            for (const tail of ['\nG0 Y30\nG0 Z1', '\nG0 Y30\nG0 Z1\nM3 S500\nG1 X10\nM5']) {
              const options = {
                text: prefix + tail,
                pixelRatio,
                sample: { x: 50, y: 0, z: 0 },
                look,
                perspective,
                travel: true,
                angle,
                alignToPixelCentre: true,
              };
              const frame = await capture(page, info, options, results, 'mixed-z-coplanar-cut');
              const withoutTravel = await capture(
                page,
                info,
                { ...options, travel: false },
                results,
                'mixed-z-coplanar-cut-travel-off',
              );
              const intendedCut = look === 'classic' ? [151, 209, 255, 255] : [79, 163, 255, 255];
              expect(frame.planar, 'the unrelated Z1 move must make the model genuinely 3D').toBe(
                false,
              );
              expect(withoutTravel.planar).toBe(false);
              expect(frame.drawingBuffer).toEqual({
                width: 800 * pixelRatio,
                height: 600 * pixelRatio,
              });
              expect(withoutTravel.drawingBuffer).toEqual(frame.drawingBuffer);
              expect(
                withoutTravel.pixel,
                'the aligned Travel-off control contains the cut',
              ).toEqual(intendedCut);
              expect(frame.pixel, 'remote off-plane moves must not expose coplanar travel').toEqual(
                intendedCut,
              );
              expect(frame.pixel).toEqual(withoutTravel.pixel);
              expect(frame.pick?.segmentIndex, 'mixed-Z picks must name the visible cut').toBe(0);
              expect(withoutTravel.pick?.segmentIndex).toBe(0);
              expect(frame.pick?.point.x).toBeCloseTo(50, 7);
              expect(withoutTravel.pick?.point.x).toBeCloseTo(50, 7);
            }
  await saveResults(info, results);
  expect(errors).toEqual([]);
});

test('varying-Z travel retains genuine nearer and farther pick depth', async ({ page }, info) => {
  const errors = await openProbe(page);
  const results: Results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true])
      for (const angle of ['top', 'iso', 'grazing'] as const)
        for (const z of [-1, 1]) {
          const dx = angle === 'top' ? 0 : angle === 'iso' ? 1 : 2;
          const dy = angle === 'top' ? 0 : angle === 'iso' ? -1 : -4;
          const startZ = z - 0.5;
          const endZ = z + 0.5;
          const text =
            'G21 G90\nM3 S500\nG1 X100 F600\nM5\n' +
            'G1 X' +
            (100 + dx * startZ) +
            ' Y' +
            dy * startZ +
            ' Z' +
            startZ +
            '\n' +
            'G1 X' +
            dx * endZ +
            ' Y' +
            dy * endZ +
            ' Z' +
            endZ;
          const frame = await capture(
            page,
            info,
            {
              text,
              sample: z > 0 ? { x: 50 + dx * z, y: dy * z, z } : { x: 50, y: 0, z: 0 },
              look,
              perspective,
              travel: true,
              // These ramp and cut paths share the original camera's projection
              // plane. Translating that camera breaks their exact overlap.
              angle,
            },
            results,
            'varying-z-depth-control',
          );
          expect(frame.planar).toBe(false);
          expect(frame.pick?.segmentIndex, 'the ramp keeps its physical depth priority').toBe(
            z > 0 ? 2 : 0,
          );
        }
  await saveResults(info, results);
  expect(errors).toEqual([]);
});

test('clipping excludes hidden endpoint snaps and measurement points but keeps visible boundary endpoints', async ({
  page,
}, info) => {
  const errors = await openProbe(page);
  const results: { name: string; options: VisiblePickOptions; frame: Omit<Frame, 'data'> }[] = [];
  for (const look of ['classic', 'studio'] as const)
    for (const perspective of [false, true]) {
      const base = {
        text: BEAM,
        sample: { x: 98.8, y: 0, z: 0 },
        look,
        perspective,
        travel: false,
      };
      const hidden = await capture(
        page,
        info,
        { ...base, planes: [{ normal: [-1, 0, 0], constant: 99 }] },
        results,
        'hidden-end',
      );
      expect(hidden.pick?.segmentIndex).toBe(0);
      expect(hidden.pick?.vertex).toBeNull();
      expect(hidden.pick?.point.x).toBeCloseTo(98.8, 7);
      expect(hidden.measuredPoint?.x).toBeCloseTo(98.8, 7);
      for (const planes of [[], [{ normal: [-1, 0, 0] as const, constant: 100 }]]) {
        const visible = await capture(page, info, { ...base, planes }, results, 'visible-end');
        expect(visible.pick?.vertex).toEqual({ x: 100, y: 0, z: 0 });
        expect(visible.measuredPoint).toEqual({ x: 100, y: 0, z: 0 });
      }
      const edge = await capture(
        page,
        info,
        {
          ...base,
          sample: { x: 99.3, y: 0, z: 0 },
          planes: [{ normal: [-1, 0, 0], constant: 99 }],
        },
        results,
        'reach-near-clip-edge',
      );
      expect(edge.pick?.point.x).toBeCloseTo(99, 7);
      expect(edge.pick?.vertex).toBeNull();
      const absent = await capture(
        page,
        info,
        { ...base, planes: [{ normal: [-1, 0, 0], constant: -1 }] },
        results,
        'wholly-clipped',
      );
      expect(absent.pick).toBeNull();
    }
  await saveResults(info, results);
  expect(errors).toEqual([]);
});

type Results = { name: string; options: VisiblePickOptions; frame: Omit<Frame, 'data'> }[];

async function pickControls(
  page: Page,
  info: TestInfo,
  look: VisiblePickOptions['look'],
  perspective: boolean,
  results: Results,
) {
  const base = { text: CUT_TRAVEL, sample: { x: 50, y: 0, z: 0 }, look, perspective, travel: true };
  const filtered = await capture(
    page,
    info,
    { ...base, hiddenSegments: [0] },
    results,
    'filtered-cut',
  );
  expect(filtered.pick?.segmentIndex, 'a hidden cut cannot win over visible travel').toBe(1);
  const withoutTravel = await capture(
    page,
    info,
    { ...base, travel: false },
    results,
    'travel-off-cut',
  );
  expect(withoutTravel.pick?.segmentIndex).toBe(0);
  for (const travel of [true, false]) {
    const onlyTravel = await capture(
      page,
      info,
      { ...base, travel, sample: { x: 0, y: 5, z: 0 } },
      results,
      'travel-only',
    );
    expect(onlyTravel.pick?.segmentIndex ?? null).toBe(travel ? 2 : null);
  }
  for (const z of [-1, 0.01, 1]) {
    const text = `G21 G90\nM3 S500\nG1 X100 F600\nM5\nG1 Z${z}\nG1 X0\nG1 Y10`;
    const frame = await capture(
      page,
      info,
      { ...base, text, sample: { x: 50, y: 0, z: Math.max(0, z) } },
      results,
      'depth-control',
    );
    expect(frame.pick?.segmentIndex, 'genuine nearer geometry must retain depth priority').toBe(
      z > 0 ? 2 : 0,
    );
  }
  await angledDepthControls(page, info, base, results);
}

async function angledDepthControls(
  page: Page,
  info: TestInfo,
  base: VisiblePickOptions,
  results: Results,
) {
  for (const angle of ['iso', 'grazing'] as const) {
    for (const z of [-1, 1]) {
      const dx = z * (angle === 'iso' ? 1 : 2);
      const dy = z * (angle === 'iso' ? -1 : -4);
      const text = `G21 G90\nM3 S500\nG1 X100 F600\nM5\nG1 X${100 + dx} Y${dy} Z${z}\nG1 X${dx}\nG1 Y10`;
      const sample = z > 0 ? { x: 50 + dx, y: dy, z } : { x: 50, y: 0, z: 0 };
      const frame = await capture(
        page,
        info,
        { ...base, text, sample, angle },
        results,
        'angled-depth-control',
      );
      expect(
        frame.pick?.segmentIndex,
        'overlapping projected paths must retain genuine scene depth',
      ).toBe(z > 0 ? 2 : 0);
    }
  }
}

async function openProbe(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/visible-pick.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Visible toolpath pick probe</title>',
    }),
  );
  await page.goto('/visible-pick.html');
  return errors;
}

async function capture(
  page: Page,
  info: TestInfo,
  options: VisiblePickOptions,
  results: Results,
  name: string,
): Promise<Frame> {
  const frame = await page.evaluate(async (input) => {
    const fixturePath = '/e2e/fixtures/visible-pick-viewer.ts';
    const fixture = (await import(
      /* @vite-ignore */ fixturePath
    )) as typeof import('./fixtures/visible-pick-viewer');
    return fixture.visiblePickFrame(input);
  }, options);
  const path = info.outputPath(`${results.length}-${name}.png`);
  await writeFile(path, Buffer.from(frame.data.split(',')[1] ?? '', 'base64'));
  await info.attach(name, { path, contentType: 'image/png' });
  const { pixel, pointer, pick, measuredPoint, planar, drawingBuffer } = frame;
  results.push({
    name,
    options,
    frame: { pixel, pointer, pick, measuredPoint, planar, drawingBuffer },
  });
  // Preserve the complete raw readout even when the next assertion fails.
  await writeFile(info.outputPath('pick-results.json'), JSON.stringify(results, null, 2));
  return frame;
}

async function saveResults(info: TestInfo, results: Results): Promise<void> {
  const path = info.outputPath('pick-results.json');
  await writeFile(path, JSON.stringify(results, null, 2));
  await info.attach('pick-readouts', { path, contentType: 'application/json' });
}
