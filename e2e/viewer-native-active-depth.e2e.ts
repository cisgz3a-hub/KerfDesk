import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/kerfdesk-test';
type Fixture = typeof import('./fixtures/native-active-body');
type Options = Parameters<Fixture['nativeActiveBodyFrame']>[0];

test('native exact-tie travel does not tint fully covered active-ramp body pixels', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const pixelRatio of [1, 2])
      for (const antialias of [true, false])
        for (const perspective of [true, false]) {
          const pair = [];
          for (const physicalActive of [false, true]) {
            const options: Options = { look, pixelRatio, antialias, perspective, physicalActive };
            const { data, ...receipt } = await page.evaluate(async (value) => {
              const path = '/e2e/fixtures/native-active-body.ts';
              const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
              return fixture.nativeActiveBodyFrame(value);
            }, options);
            const name = `${look}-${pixelRatio}-${antialias}-${perspective}-${physicalActive}`;
            const path = info.outputPath(name + '.png');
            await writeFile(path, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
            await info.attach(name, { path, contentType: 'image/png' });
            pair.push(receipt);
          }
          results.push(pair);
          // Persist inputs, actual uniforms, admissions and failures before asserting.
          await writeFile(
            info.outputPath('native-body-samples.json'),
            JSON.stringify(results, null, 2),
          );
          const [candidate, reference] = pair;
          if (candidate === undefined || reference === undefined)
            throw new Error('Missing matched frame');
          expect(candidate.matrices).toEqual(reference.matrices);
          expect(candidate.placed).toEqual([0, 0, 0, 50, 0, 0.5]);
          expect(candidate.source).toEqual(reference.source);
          expect(candidate.widthCSS).toBe(4);
          expect(candidate.resolution).toEqual([800, 600]);
          expect(reference.pixels).toHaveLength(2);
          if (antialias) expect(candidate.samples).toBeGreaterThan(0);
          else expect(candidate.samples).toBe(0);
          if (pixelRatio === 1 && perspective)
            expect(candidate.pixels.map((pixel) => pixel.pixel)).toEqual([
              [241, 299],
              [241, 300],
            ]);
          for (const [index, pixel] of candidate.pixels.entries()) {
            const expected = reference.pixels[index];
            if (expected === undefined) throw new Error('Missing reference pixel');
            expect(pixel.pixel).toEqual(expected.pixel);
            for (const [channel, value] of pixel.rgba.entries()) {
              const expectedChannel = expected.rgba[channel];
              if (expectedChannel === undefined) throw new Error('Missing reference channel');
              expect(Math.abs(value - expectedChannel)).toBeLessThanOrEqual(1);
              // The original DPR2 fallback shares the admitted tint. A strict
              // analytical white tie, rather than matching it, proves the repair.
              const whiteChannel = [242, 244, 248, 255][channel];
              if (whiteChannel === undefined) throw new Error('Missing white channel');
              expect(Math.abs(expectedChannel - whiteChannel)).toBeLessThanOrEqual(1);
            }
          }
        }
});

test('non-dyadic production prefix retains its full-source native depth tie', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const results = [];
  for (const look of ['classic', 'studio'] as const)
    for (const pixelRatio of [1, 2])
      for (const antialias of [true, false])
        for (const perspective of [true, false]) {
          const pair = [];
          for (const physicalActive of [false, true]) {
            const options: Options = {
              look,
              pixelRatio,
              antialias,
              perspective,
              physicalActive,
              prefixFraction: 0.3,
            };
            const { data, ...receipt } = await page.evaluate(async (value) => {
              const path = '/e2e/fixtures/native-active-body.ts';
              const fixture = (await import(/* @vite-ignore */ path)) as Fixture;
              return fixture.nativeActiveBodyFrame(value);
            }, options);
            const name = `${look}-${pixelRatio}-${antialias}-${perspective}-${physicalActive}`;
            const path = info.outputPath(name + '.png');
            await writeFile(path, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
            await info.attach(name, { path, contentType: 'image/png' });
            pair.push(receipt);
          }
          results.push(pair);
          // Save both unchanged body pixels and the actual source descriptors before assertions.
          await writeFile(
            info.outputPath('non-dyadic-native-body-samples.json'),
            JSON.stringify(results, null, 2),
          );
          const [candidate, reference] = pair;
          if (candidate === undefined || reference === undefined)
            throw new Error('Missing matched non-dyadic frame');
          expect(candidate.matrices).toEqual(reference.matrices);
          expect(candidate.source).toEqual(reference.source);
          for (const frame of pair) {
            expect(frame.prefixFraction).toBe(0.3);
            expect(frame.placedStorageFloat32).toBe(true);
            expect(frame.sourceStorageFloat32).toBe(true);
            expect(frame.placed).toEqual([0, 0, 0, 30, 0, Math.fround(0.3)]);
            expect(frame.placed[5]).not.toBe(0.3);
            expect(frame.sourceEndpoints).toEqual([0, 0, 0, 100, 0, 1]);
            expect(frame.sourcePlane).toEqual([Math.fround(-0.01), 0, 1, 0]);
            expect(frame.sourcePlaneOffset).toEqual([0]);
            expect(frame.activePlane).toEqual(frame.sourcePlane);
            expect(frame.activePlaneOffset).toEqual(frame.sourcePlaneOffset);
            expect(frame.activePlaneBits).toEqual(frame.sourcePlaneBits);
            expect(frame.rebuiltPrefixPlane).toEqual([
              Math.fround(-Math.fround(0.3) / 30),
              0,
              1,
              0,
            ]);
            expect(frame.rebuiltPrefixPlane.slice(0, 3)).not.toEqual(frame.sourcePlane.slice(0, 3));
            expect(frame.rebuiltPrefixPlaneBits).not.toEqual(frame.sourcePlaneBits);
            expect(frame.rebuiltPrefixPlaneOffset).toEqual([0]);
            expect(frame.widthCSS).toBe(4);
            expect(frame.resolution).toEqual([800, 600]);
            expect(frame.pixels).toHaveLength(2);
            if (antialias) expect(frame.samples).toBeGreaterThan(0);
            else expect(frame.samples).toBe(0);
            if (pixelRatio === 1 && perspective)
              expect(frame.pixels.map((pixel) => pixel.pixel)).toEqual([
                [241, 299],
                [241, 300],
              ]);
          }
          for (const [index, pixel] of candidate.pixels.entries()) {
            const expected = reference.pixels[index];
            if (expected === undefined) throw new Error('Missing non-dyadic reference pixel');
            expect(pixel.pixel).toEqual(expected.pixel);
            for (const [channel, value] of pixel.rgba.entries()) {
              const expectedChannel = expected.rgba[channel];
              if (expectedChannel === undefined) throw new Error('Missing reference channel');
              expect(Math.abs(value - expectedChannel)).toBeLessThanOrEqual(1);
              const whiteChannel = [242, 244, 248, 255][channel];
              if (whiteChannel === undefined) throw new Error('Missing white channel');
              expect(Math.abs(expectedChannel - whiteChannel)).toBeLessThanOrEqual(1);
            }
          }
        }
});
