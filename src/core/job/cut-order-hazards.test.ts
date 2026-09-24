import { describe, expect, it } from 'vitest';
import { artwork, operation, raster } from '../cut-order.test-support';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { REGISTRATION_LAYER_ID, type Layer, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import { detectCutOrderHazards } from './cut-order-hazards';

function hazards(
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  artworkOrder?: ReadonlyArray<string>,
) {
  const job = compileJob(
    { layers, objects, ...(artworkOrder === undefined ? {} : { artworkOrder }) },
    DEFAULT_DEVICE_PROFILE,
  );
  return detectCutOrderHazards(job);
}

const outline = artwork('outline', [{ operationId: 'cut', rect: [0, 0, 50, 50] }]);
const logo = artwork('logo', [{ operationId: 'engrave', rect: [10, 10, 10, 10] }]);

describe('detectCutOrderHazards', () => {
  it('finds a closed cut that runs before the engraving inside it', () => {
    expect(
      hazards(
        [operation('cut'), operation('engrave', 'fill')],
        [outline, logo],
        ['outline', 'logo'],
      ),
    ).toEqual([{ cutLayerId: 'cut', enclosedLayerId: 'engrave' }]);
  });

  it('finds it inside one artwork when the cut operation is listed first', () => {
    const panel = artwork('panel', [
      { operationId: 'cut', rect: [0, 0, 50, 50] },
      { operationId: 'engrave', rect: [10, 10, 10, 10] },
    ]);

    expect(hazards([operation('cut'), operation('engrave', 'fill')], [panel])).toEqual([
      { cutLayerId: 'cut', enclosedLayerId: 'engrave' },
    ]);
    expect(hazards([operation('engrave', 'fill'), operation('cut')], [panel])).toEqual([]);
  });

  it('stays quiet when the engraving runs first', () => {
    expect(
      hazards(
        [operation('cut'), operation('engrave', 'fill')],
        [outline, logo],
        ['logo', 'outline'],
      ),
    ).toEqual([]);
  });

  it('stays quiet for later work outside the cut', () => {
    const beside = artwork('beside', [{ operationId: 'engrave', rect: [70, 10, 10, 10] }]);

    expect(
      hazards(
        [operation('cut'), operation('engrave', 'fill')],
        [outline, beside],
        ['outline', 'beside'],
      ),
    ).toEqual([]);
  });

  it('stays quiet when tabs hold the part', () => {
    const tabbed = { ...operation('cut'), tabsEnabled: true, tabsPerShape: 4, tabSizeMm: 1 };

    expect(
      hazards([tabbed, operation('engrave', 'fill')], [outline, logo], ['outline', 'logo']),
    ).toEqual([]);
  });

  it('leaves contours on the same operation to the inside-first order', () => {
    const nested = artwork('nested', [
      { operationId: 'cut', rect: [0, 0, 50, 50] },
      { operationId: 'cut', rect: [10, 10, 10, 10] },
    ]);

    expect(hazards([operation('cut')], [nested])).toEqual([]);
  });

  it('counts an image engraving and ignores the registration jig outline', () => {
    const photo = raster('photo', 'image', [10, 10, 20, 20]);
    const jig = artwork('jig', [{ operationId: REGISTRATION_LAYER_ID, rect: [0, 0, 50, 50] }]);

    expect(
      hazards(
        [operation('cut'), operation('image', 'image')],
        [outline, photo],
        ['outline', 'photo'],
      ),
    ).toEqual([{ cutLayerId: 'cut', enclosedLayerId: 'image' }]);
    expect(
      hazards(
        [operation(REGISTRATION_LAYER_ID), operation('engrave', 'fill')],
        [jig, logo],
        ['jig', 'logo'],
      ),
    ).toEqual([]);
  });
});
