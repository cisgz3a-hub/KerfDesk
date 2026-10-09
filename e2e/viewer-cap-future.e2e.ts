import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/kerfdesk-test';

type Fixture = typeof import('./fixtures/cap-future-witness');
type Options = Parameters<Fixture['capFutureFrame']>[0];
type Frame = ReturnType<Fixture['capFutureFrame']>;

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function maxDelta(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('Different channel counts');
  return Math.max(
    ...a.map((value, index) =>
      Math.abs(value - requireValue(b[index], 'Missing comparison channel')),
    ),
  );
}

for (const kind of ['cap', 'future'] as const)
  for (const look of ['classic', 'studio'] as const)
    for (const dpr of [1, 2] as const)
      test(
        'fixed ' + kind + ' witness matches source order: ' + look + ' DPR' + dpr,
        async ({ page }, info) => {
          await page.goto('/');
          const frames: Frame[] = [];
          for (const mode of ['candidate', 'source-order'] as const) {
            const options: Options = { kind, look, dpr, mode };
            const frame = await page.evaluate(async (input) => {
              const path = '/e2e/fixtures/cap-future-witness.ts';
              const fixture: Fixture = await import(path);
              return fixture.capFutureFrame(input);
            }, options);
            frames.push(frame);
            // Persist both frames and their fixed-coordinate admissions before assertions.
            const png = info.outputPath(mode + '.png');
            const payload = requireValue(frame.data.split(',')[1], 'Missing captured PNG payload');
            await writeFile(png, Buffer.from(payload, 'base64'));
            await info.attach(mode, { path: png, contentType: 'image/png' });
          }
          const receipt = info.outputPath('fixed-pixel-receipt.json');
          const receiptFrames = frames.map(({ data, ...frame }) => {
            void data;
            return frame;
          });
          await writeFile(receipt, JSON.stringify(receiptFrames, null, 2));
          await info.attach('fixed-pixel-receipt', {
            path: receipt,
            contentType: 'application/json',
          });
          const candidate = requireValue(frames[0], 'Missing candidate frame');
          const reference = requireValue(frames[1], 'Missing source-order frame');
          for (const frame of frames) {
            expect(frame.backend.samples, 'Preserve the witnessed MSAA4 backend').toBe(4);
            expect(frame.glError).toBe(0);
            expect(frame.placedFloat32).toEqual([100, 0, -10, 50, 0, -5]);
            expect(frame.camera).toEqual({
              position: [150, -150, 50],
              target: [50, 0, -5],
              up: [0, 0, 1],
              near: 0.1,
              far: 100_000,
              perspective: kind === 'future',
            });
            expect(frame.trail).toEqual({ start: 0, end: 1, fade: 0 });
            const core = frame.draws.filter((draw) => draw.role === 'core');
            expect(core).toHaveLength(1);
            const coreDraw = requireValue(core[0], 'Missing actual current core draw');
            expect(coreDraw.linewidthCSS).toBe(4);
            expect(coreDraw.materialWidthCSS).toBe(4);
            const completed = frame.draws.filter((draw) => draw.role === 'completed');
            expect(completed.length).toBeGreaterThan(0);
            for (const draw of [...core, ...completed]) {
              expect(draw.positionStorageFloat32).toBe(true);
              expect(draw.instanceCount).toBe(1);
              expect(draw.logicalViewport).toEqual([0, 0, 800, 600]);
              expect(draw.physicalViewport).toEqual([0, 0, 800 * dpr, 600 * dpr]);
              expect(draw.resolution).toEqual([800, 600]);
              expect(draw.framebuffer).toEqual([800 * dpr, 600 * dpr]);
              if (draw.role === 'completed') {
                expect(draw.linewidthCSS).toBe(6);
                expect(draw.materialWidthCSS).toBe(6);
                expect(draw.instances[0]).toEqual({
                  index: 0,
                  start: [0, 0, 0],
                  end: [100, 0, -10],
                });
              }
            }
            const ghosts = frame.draws.filter((draw) => draw.role === 'ghost');
            expect(ghosts.length).toBeGreaterThan(0);
            for (const draw of ghosts) {
              expect(draw.ghostTail).not.toBeNull();
              const tail = requireValue(
                draw.ghostTail,
                'Missing uploaded full-resolution ghost-tail uniforms',
              );
              expect(tail.enabled).toBe(1);
              expect(tail.index).toBe(1);
              expect(tail.point).toEqual([50, 0, -5]);
              expect(tail.coreWidthCSS).toBe(coreDraw.linewidthCSS);
              expect(tail.viewport).toEqual(draw.physicalViewport);
              expect(tail.scale).toEqual([dpr, dpr]);
              expect(draw.instances[1]).toEqual({ index: 1, start: [100, 0, -10], end: [0, 0, 0] });
            }
            if (frame.options.mode === 'source-order') {
              expect(completed).toHaveLength(1);
              expect(ghosts).toHaveLength(1);
              expect(
                requireValue(completed[0], 'Missing reference completed draw').originalFirst,
              ).toBe(true);
              expect(requireValue(ghosts[0], 'Missing reference ghost draw').originalFirst).toBe(
                true,
              );
            }
            // No split flag or particular program key is required: retiring batching is valid.
            expect(frame.samples).toHaveLength(dpr === 1 ? 1 : 4);
            for (const sample of frame.samples) {
              expect(sample.coverage.inBounds).toBe(true);
              expect(
                sample.coverage.admitted,
                'Every pixel corner must be inside the uploaded stroke with a 0.1 CSS inward margin',
              ).toBe(true);
              if (kind === 'cap') {
                expect(sample.coverage.radiusCSS).toBe(2);
                expect(sample.activeCoverage.distanceFromTipCSS).toBeLessThan(2);
              } else {
                expect(sample.coverage.radiusCSS).toBe(3);
                expect(
                  sample.coverage.cornerFractions.every((value) => value > 0 && value < 1),
                ).toBe(true);
                expect(sample.activeCoverage.distanceFromTipCSS).toBeGreaterThan(80);
                expect(sample.futureCoverage.centreFraction).toBeGreaterThan(0);
                expect(sample.futureCoverage.centreFraction).toBeLessThan(1);
                // A DPR2 subpixel need only intersect the 1 CSS pixel tail, not contain its centreline.
                expect(Math.min(...sample.futureCoverage.cornerDistancesCSS)).toBeLessThan(
                  sample.futureCoverage.radiusCSS,
                );
                if (dpr === 1)
                  expect(sample.futureCoverage.centreDistanceCSS).toBeLessThan(
                    sample.futureCoverage.radiusCSS,
                  );
                // Non-vacuity at a fixed coordinate, never a colour-based admission or search.
                expect(
                  maxDelta(sample.rgba.slice(0, 3), frame.backgroundRGBA.slice(0, 3)),
                ).toBeGreaterThan(4);
              }
              expect(sample.rgba[3]).toBe(255);
            }
          }
          expect(candidate.samples.map((sample) => sample.pixel)).toEqual(
            reference.samples.map((sample) => sample.pixel),
          );
          const expectedPixels =
            kind === 'cap'
              ? dpr === 1
                ? [[401, 299]]
                : [
                    [802, 598],
                    [803, 598],
                    [802, 599],
                    [803, 599],
                  ]
              : dpr === 1
                ? [[313, 273]]
                : [
                    [626, 546],
                    [627, 546],
                    [626, 547],
                    [627, 547],
                  ];
          expect(candidate.samples.map((sample) => sample.pixel)).toEqual(expectedPixels);
          for (const [index, sample] of candidate.samples.entries()) {
            const paired = requireValue(
              reference.samples[index],
              'Missing paired fixed reference pixel',
            );
            expect(
              maxDelta(sample.rgba, paired.rgba),
              'Strict same-factory source-order RGBA at the unchanged fixed pixel',
            ).toBeLessThanOrEqual(1);
          }
          // Only this primary cap has a recorded pure-white expectation. Do not generalise it.
          if (kind === 'cap' && look === 'classic' && dpr === 1)
            for (const frame of frames) {
              const primary = requireValue(frame.samples[0], 'Missing primary admitted core pixel');
              expect(
                maxDelta(primary.rgba, [242, 244, 248, 255]),
                'The primary admitted core pixel must remain white',
              ).toBeLessThanOrEqual(1);
            }
        },
      );
