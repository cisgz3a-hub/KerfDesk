import { describe, expect, it, vi } from 'vitest';
import { prepareStampSource, canPrepareStamp } from './stamp-source';
import { stampFixture } from '../state/stamp-preparation.test-fixture';
import { jointResizeFixture } from '../state/joint-resize.test-fixture';
import type * as VectorBitmapModule from './vector-to-bitmap';
import { buildBitmapFromVectors } from './vector-to-bitmap';
vi.mock('./vector-to-bitmap', async (importOriginal) => {
  const actual = await importOriginal<typeof VectorBitmapModule>();
  return { ...actual, buildBitmapFromVectors: vi.fn(async () => stampFixture().image) };
});
describe('stamp source ownership', () => {
  it('uses exact raw pixels and physical scaling; brightness is explicitly not baked', async () => {
    const { project, image } = stampFixture();
    const original = { ...image, brightness: 100 };
    const prepared = await prepareStampSource(
      { ...project, scene: { ...project.scene, objects: [original] } },
      ['source'],
      254,
      new AbortController().signal,
    );
    expect(Array.from(prepared.pixels.luma)).toEqual([0, 255, 255, 255, 255, 0]);
    expect(prepared.pixels.widthMm).toBe(12);
    expect(prepared.pixels.heightMm).toBe(6);
    expect(prepared.image).toBe(original);
  });
  it('honours owned masks before thresholding without modifying their source', async () => {
    const { project, image } = stampFixture();
    const masked = { ...image, imageClip: [] };
    const prepared = await prepareStampSource(
      { ...project, scene: { ...project.scene, objects: [masked] } },
      ['source'],
      254,
      new AbortController().signal,
    );
    expect(Array.from(prepared.pixels.luma)).toEqual([255, 255, 255, 255, 255, 255]);
    expect(masked.lumaBase64).toBe(image.lumaBase64);
  });
  it('rejects mixed or open artwork and corrupted pixels; accepts closed canonical geometry', async () => {
    const { project, image } = stampFixture();
    const { object } = jointResizeFixture();
    expect(canPrepareStamp([object])).toBe(true);
    await prepareStampSource(
      { ...project, scene: { ...project.scene, objects: [object] } },
      [object.id],
      254,
      new AbortController().signal,
    );
    expect(buildBitmapFromVectors).toHaveBeenCalledWith(
      [object],
      { dpi: 254, renderType: 'fill-all', brightnessPercent: 0 },
      expect.any(AbortSignal),
    );
    expect(canPrepareStamp([image, object])).toBe(false);
    expect(
      canPrepareStamp([
        {
          ...object,
          paths: object.paths.map((path) => ({
            ...path,
            polylines: path.polylines.map((line) => ({ ...line, closed: false })),
          })),
        },
      ]),
    ).toBe(false);
    await expect(
      prepareStampSource(
        { ...project, scene: { ...project.scene, objects: [{ ...image, lumaBase64: 'AA==' }] } },
        ['source'],
        254,
        new AbortController().signal,
      ),
    ).rejects.toThrow('pixel bytes');
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareStampSource(project, ['source'], 254, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
