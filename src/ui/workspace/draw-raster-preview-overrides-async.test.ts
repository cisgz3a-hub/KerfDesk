import { afterEach, expect, it, vi } from 'vitest';
import type { RasterImage } from '../../core/scene';
import {
  gray,
  normalizedCompiledPixels,
  pagedPreviewRaster,
  previewLayer,
  previewProject,
  previewRaster,
  previewSink,
} from './raster-preview.test-support';

const hydrations = vi.hoisted(
  (): Array<{ image: RasterImage; signal: AbortSignal | undefined; resolve: () => void }> => [],
);
vi.mock('../import/paged-raster-hydration', () => ({
  hydratePagedRasterImage: (image: RasterImage, _repo: unknown, signal?: AbortSignal) =>
    new Promise<RasterImage>((resolve) => {
      hydrations.push({ image, signal, resolve: () => resolve(image) });
    }),
}));
afterEach(() => {
  previewSink().draw(previewProject([]));
  hydrations.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
function scheduler() {
  const tasks: Array<{ work: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
  return {
    tasks,
    schedule: (work: () => void) => {
      const cancel = vi.fn();
      tasks.push({ work, cancel });
      return cancel;
    },
  };
}

it('cancels obsolete effective settings and ignores a cancelled nonpaged callback', () => {
  const sink = previewSink(),
    queue = scheduler(),
    first = { ...previewRaster(), operationOverride: { negativeImage: false } },
    next = { ...first, operationOverride: { negativeImage: true } },
    ready = vi.fn();
  sink.draw(previewProject([first]), queue.schedule, ready);
  sink.draw(previewProject([next]), queue.schedule, ready);
  expect(queue.tasks[0]?.cancel).toHaveBeenCalledOnce();
  queue.tasks[0]?.work();
  expect(sink.built).toHaveLength(0);
  expect(ready).not.toHaveBeenCalled();
  queue.tasks[1]?.work();
  sink.draw(previewProject([next]), queue.schedule);
  expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(previewProject([next])));
});
for (const olderFirst of [false, true])
  it(`paged effective-setting supersession keeps replacement ownership, olderFirst=${olderFirst}`, async () => {
    const sink = previewSink(),
      first = {
        ...pagedPreviewRaster('paged', 'pixels-a'),
        operationOverride: { negativeImage: false },
      },
      next = { ...first, operationOverride: { negativeImage: true } },
      ready = vi.fn(),
      schedule = (work: () => void) => {
        work();
        return vi.fn();
      };
    sink.draw(previewProject([first]), schedule, ready);
    sink.draw(previewProject([next]), schedule, ready);
    expect(hydrations).toHaveLength(2);
    expect(hydrations[0]?.signal?.aborted).toBe(true);
    hydrations[olderFirst ? 0 : 1]?.resolve();
    await tick();
    sink.draw(previewProject([next]), schedule, ready);
    expect(hydrations).toHaveLength(2);
    hydrations[olderFirst ? 1 : 0]?.resolve();
    await tick();
    sink.drawn.length = 0;
    sink.draw(previewProject([next]), schedule);
    expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(previewProject([next])));
    expect(ready).toHaveBeenCalledOnce();
  });
for (const ineligible of ['removed', 'mode', 'disabled'] as const)
  it(`paged build is cancelled when effective preview becomes ${ineligible}`, async () => {
    const sink = previewSink(),
      raster = {
        ...pagedPreviewRaster('removed', 'pixels'),
        operationOverride: { mode: 'image' as const },
      },
      schedule = (work: () => void) => {
        work();
        return vi.fn();
      },
      ready = vi.fn();
    sink.draw(previewProject([raster]), schedule, ready);
    const p =
      ineligible === 'removed'
        ? previewProject([])
        : previewProject(
            [{ ...raster, operationOverride: { mode: ineligible === 'mode' ? 'line' : 'image' } }],
            [previewLayer({ output: ineligible !== 'disabled' })],
          );
    sink.draw(p, schedule, ready);
    expect(hydrations[0]?.signal?.aborted).toBe(true);
    hydrations[0]?.resolve();
    await tick();
    expect(sink.built).toHaveLength(0);
    expect(ready).not.toHaveBeenCalled();
  });
it('a changed source and settings under the same ID cannot overwrite a completed replacement', async () => {
  const sink = previewSink(),
    first = {
      ...pagedPreviewRaster('revision', 'old'),
      operationOverride: { negativeImage: false },
    },
    next = {
      ...pagedPreviewRaster('revision', 'new'),
      lumaBase64: btoa(String.fromCharCode(...new Array<number>(32).fill(255))),
      operationOverride: { negativeImage: true },
    },
    schedule = (work: () => void) => {
      work();
      return vi.fn();
    };
  sink.draw(previewProject([first]), schedule);
  sink.draw(previewProject([next]), schedule);
  hydrations[1]?.resolve();
  await tick();
  sink.draw(previewProject([next]), schedule);
  const completed = sink.drawn.at(-1);
  hydrations[0]?.resolve();
  await tick();
  sink.draw(previewProject([next]), schedule);
  expect(sink.drawn.at(-1)).toBe(completed);
  expect(hydrations).toHaveLength(2);
  expect(hydrations[0]?.signal?.aborted).toBe(true);
});
it('retains all concurrently bound effective keys and cancels only a removed operation', async () => {
  const raster = { ...pagedPreviewRaster('multi', 'pixels'), operationIds: ['image', 'other'] },
    a = previewLayer(),
    b = previewLayer({ id: 'other', negativeImage: true }),
    sink = previewSink(),
    schedule = (work: () => void) => {
      work();
      return vi.fn();
    };
  sink.draw(previewProject([raster], [a, b]), schedule);
  expect(hydrations).toHaveLength(2);
  expect(hydrations.every((h) => !h.signal?.aborted)).toBe(true);
  sink.draw(previewProject([raster], [b]), schedule);
  expect(hydrations[0]?.signal?.aborted).toBe(true);
  expect(hydrations[1]?.signal?.aborted).toBe(false);
  hydrations[0]?.resolve();
  hydrations[1]?.resolve();
  await tick();
  sink.draw(previewProject([raster], [b]), schedule);
  expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(previewProject([raster], [b])));
});

it('keeps a pending overridden result through a parent change and replaces it when inheritance returns', async () => {
  const raster = {
      ...pagedPreviewRaster('inherit', 'pixels'),
      operationOverride: { negativeImage: false },
    },
    sink = previewSink(),
    schedule = (work: () => void) => {
      work();
      return vi.fn();
    };
  sink.draw(previewProject([raster], [previewLayer({ negativeImage: false })]), schedule);
  sink.draw(previewProject([raster], [previewLayer({ negativeImage: true })]), schedule);
  expect(hydrations).toHaveLength(1);
  expect(hydrations[0]?.signal?.aborted).toBe(false);
  const inherited = previewProject(
    [pagedPreviewRaster('inherit', 'pixels')],
    [previewLayer({ negativeImage: true })],
  );
  sink.draw(inherited, schedule);
  expect(hydrations).toHaveLength(2);
  expect(hydrations[0]?.signal?.aborted).toBe(true);
  hydrations[0]?.resolve();
  await tick();
  sink.draw(inherited, schedule);
  expect(hydrations).toHaveLength(2);
  hydrations[1]?.resolve();
  await tick();
  sink.draw(inherited, schedule);
  expect(sink.drawn.map(gray)).toEqual(normalizedCompiledPixels(inherited));
});
