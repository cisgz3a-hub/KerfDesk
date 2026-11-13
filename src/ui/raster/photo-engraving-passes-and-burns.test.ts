// Tools audit T1, T15: the photo preview is budgeted once per scan angle, not
// once per pass (T15-P2-2), and the window names the photo's other burns,
// which keep their own settings (T15R-P2-1, T15-P2-1).
import { describe, expect, it } from 'vitest';
import { createLayer, createLayerSubLayer, type Layer, type RasterImage } from '../../core/scene';
import { otherPhotoBurns, otherPhotoBurnsSentence } from './photo-engraving-other-burns';
import { photoEngravingPreviewPlan } from './photo-engraving-preview-budget';
import { photoPreviewFixture } from './photo-engraving-preview.test-support';

function largePhoto(passes: number) {
  const base = photoPreviewFixture();
  const width = 1000;
  const height = 750;
  const image: RasterImage = {
    ...base.image,
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 150 },
    lumaBase64: Buffer.alloc(width * height, 128).toString('base64'),
  };
  return {
    ...base,
    image,
    sceneObjects: [image],
    layer: { ...base.layer, ditherAlgorithm: 'jarvis' as const, linesPerMm: 10, passes },
  };
}

describe('photo preview budget (T15-P2-2)', () => {
  it.each([1, 4, 17, 40])(
    'previews a 200 × 150 mm photo at 10 lines/mm with %s passes',
    (passes) => {
      expect(photoEngravingPreviewPlan(largePhoto(passes)).kind).toBe('ok');
    },
  );
});

describe('the photo’s other burns (T15R-P2-1, T15-P2-1)', () => {
  const image = { ...photoPreviewFixture().image, operationIds: ['main', 'second'] };
  const main: Layer = {
    ...createLayer({ id: 'main', color: '#808080', mode: 'image' }),
    name: 'Photo',
  };
  const second: Layer = {
    ...createLayer({ id: 'second', color: '#808081', mode: 'image' }),
    name: 'Photo 2',
  };

  it('names another output operation the photo burns through', () => {
    const burns = otherPhotoBurns(image, main, [main, second]);
    expect(burns).toEqual(['operation “Photo 2”']);
    expect(otherPhotoBurnsSentence(burns)).toBe(
      'This photo also burns through operation “Photo 2”, which keeps its own marking, dither and DPI.',
    );
  });

  it('leaves out an operation with Output off and an unrelated one', () => {
    const off = { ...second, output: false };
    const other: Layer = { ...createLayer({ id: 'other', color: '#000000', mode: 'image' }) };
    expect(otherPhotoBurns(image, main, [main, off, other])).toEqual([]);
    expect(otherPhotoBurnsSentence([])).toBeNull();
  });

  it('names an enabled image sub-pass of the operation', () => {
    const withSub: Layer = {
      ...main,
      subLayers: [createLayerSubLayer(main, { id: 'sub-1', label: 'Pass 2' })],
    };
    expect(otherPhotoBurns(image, withSub, [withSub])).toEqual(['sub-pass “Pass 2”']);
  });
});
