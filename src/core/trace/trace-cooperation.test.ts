import { describe, expect, it } from 'vitest';
import { PERCEPTUAL_FIXTURES } from '../../__fixtures__/perceptual/shapes';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import type { TraceSteps } from './trace-steps';

describe('incremental trace geometry and interruption', () => {
  for (const name of ['Line Art', 'Smooth', 'Sharp', 'Centerline', 'Edge Detection'] as const) {
    it(`${name} keeps complete geometry and source bytes when paused between every step`, async () => {
      const image = PERCEPTUAL_FIXTURES.find((fixture) => fixture.name === 'square-glyph')!.image;
      const bytes = new Uint8ClampedArray(image.data);
      const options = TRACE_PRESETS[name]!;
      const direct = await traceImageToColoredPaths(image, options);
      let pauses = 0;
      const stepped = await traceImageToColoredPaths(
        image,
        options,
        async <T>(steps: TraceSteps<T>) => {
          for (;;) {
            const next = steps.next(true);
            if (next.done) return next.value;
            pauses++;
            await Promise.resolve();
          }
        },
      );
      expect(pauses).toBeGreaterThan(10);
      expect(stepped).toEqual(direct);
      expect(image.data).toEqual(bytes);
    });

    it(`${name} propagates interruption without returning partial geometry`, async () => {
      const image = PERCEPTUAL_FIXTURES.find((fixture) => fixture.name === 'square-glyph')!.image;
      const bytes = new Uint8ClampedArray(image.data);
      const interrupted = new Error('interrupted at a processing checkpoint');
      let entered = false;
      const trace = traceImageToColoredPaths(
        image,
        TRACE_PRESETS[name]!,
        <T>(steps: TraceSteps<T>): T => {
          for (let checkpoint = 0; checkpoint < 5; checkpoint++) {
            expect(steps.next(true).done).toBe(false);
          }
          entered = true;
          steps.return(undefined as never);
          throw interrupted;
        },
      );
      await expect(trace).rejects.toBe(interrupted);
      expect(entered).toBe(true);
      expect(image.data).toEqual(bytes);
    });
  }
});
