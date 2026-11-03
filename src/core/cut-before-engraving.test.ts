import { describe, expect, it } from 'vitest';
import { cutsBeforeEngraving } from './cut-before-engraving';
import { DEFAULT_DEVICE_PROFILE } from './devices';
import { compileJob } from './job';
import {
  createLayer,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Scene,
  type SceneObject,
} from './scene';
import { sortCutsLast } from './sort-cuts-last';

const CUT_COLOR = '#0000ff';
const ENGRAVE_COLOR = '#ff0000';

function square(id: string, color: string, minX: number, size: number, closed = true): SceneObject {
  const max = minX + size;
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    bounds: { minX, minY: minX, maxX: max, maxY: max },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: minX, y: minX },
              { x: max, y: minX },
              { x: max, y: max },
              { x: minX, y: max },
            ],
            closed,
          },
        ],
      },
    ],
  };
}

const cutLayer = (settings: Partial<Layer> = {}): Layer => ({
  ...createLayer({ id: 'cut', color: CUT_COLOR }),
  name: 'Outline',
  mode: 'line',
  power: 100,
  speed: 300,
  ...settings,
});

const engraveLayer = (settings: Partial<Layer> = {}): Layer => ({
  ...createLayer({ id: 'engrave', color: ENGRAVE_COLOR }),
  name: 'Name',
  mode: 'fill',
  ...settings,
});

function coaster(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { ...EMPTY_SCENE, objects, layers };
}

function findings(scene: Scene) {
  return cutsBeforeEngraving(compileJob(scene, DEFAULT_DEVICE_PROFILE));
}

const outline = square('outline', CUT_COLOR, 10, 80);
const name = square('name', ENGRAVE_COLOR, 40, 20);

describe('cutsBeforeEngraving', () => {
  it('finds an outline cut drawn before the engraving inside it', () => {
    const scene = coaster([outline, name], [cutLayer(), engraveLayer()]);

    expect(findings(scene)).toEqual([{ cutLayerId: 'cut', engravingLayerIds: ['engrave'] }]);
  });

  it('is quiet once Sort cuts last has run', () => {
    const scene = coaster([outline, name], [cutLayer(), engraveLayer()]);

    expect(findings(sortCutsLast(scene).scene)).toEqual([]);
  });

  it('is quiet when the engraving already runs first', () => {
    expect(findings(coaster([name, outline], [engraveLayer(), cutLayer()]))).toEqual([]);
  });

  it('ignores engraving outside the outline', () => {
    const beside = square('beside', ENGRAVE_COLOR, 120, 20);

    expect(findings(coaster([outline, beside], [cutLayer(), engraveLayer()]))).toEqual([]);
  });

  it('does not call a light score frame a cut', () => {
    const scene = coaster([outline, name], [cutLayer({ power: 10, speed: 3000 }), engraveLayer()]);

    expect(findings(scene)).toEqual([]);
  });

  it('flags a lighter score line that runs after the cut inside it', () => {
    const scene = coaster(
      [outline, name],
      [cutLayer(), engraveLayer({ mode: 'line', power: 20, speed: 3000 })],
    );

    expect(findings(scene)).toEqual([{ cutLayerId: 'cut', engravingLayerIds: ['engrave'] }]);
  });

  it('ignores an open outline, which frees nothing', () => {
    const open = square('outline', CUT_COLOR, 10, 80, false);

    expect(findings(coaster([open, name], [cutLayer(), engraveLayer()]))).toEqual([]);
  });

  it('ignores a cut held by tabs', () => {
    const scene = coaster(
      [outline, name],
      [cutLayer({ tabsEnabled: true, tabsPerShape: 4, tabSizeMm: 1 }), engraveLayer()],
    );

    expect(findings(scene)).toEqual([]);
  });
});
