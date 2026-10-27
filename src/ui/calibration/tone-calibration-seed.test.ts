import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  DEFAULT_TONE_WEDGE_DRAFT,
  seededToneWedgeDraft,
  toneWedgeOptions,
  toneWedgeSettings,
  type ToneCalibrationSeed,
} from './tone-calibration-draft';
import { openToneCalibration, useToneCalibrationStore } from './tone-calibration-store';

function selectPhoto(operationPatch: Partial<Layer>, image: Partial<RasterImage>): void {
  const operation: Layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    ...operationPatch,
  };
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'portrait',
    source: 'portrait.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(String.fromCharCode(0, 96, 255, 255, 96, 0)),
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'jarvis',
    linesPerMm: 10,
    operationIds: ['photo'],
    ...image,
  };
  const project = { ...createProject(), scene: { objects: [photo], layers: [operation] } };
  useStore.setState({ project, selectedObjectId: photo.id, additionalSelectedIds: new Set() });
}

function openedSeed(): ToneCalibrationSeed | null {
  openToneCalibration();
  return useToneCalibrationStore.getState().session?.seed ?? null;
}

beforeEach(() => {
  resetStore();
  useToneCalibrationStore.setState({ session: null });
});

describe('Tone Calibration seed power (ADR-670 Amd 1, audit G1-P3-2)', () => {
  it("seeds the photo's burn power: the operation's power and floor times its multiplier", () => {
    selectPhoto({ power: 60, minPower: 20 }, { powerScale: 25 });
    const seed = openedSeed();
    expect(seed?.settings).toMatchObject({ power: 15, minPower: 5, ditherAlgorithm: 'jarvis' });
    const draft = seededToneWedgeDraft(seed!, DEFAULT_TONE_WEDGE_DRAFT);
    expect(draft.power).toBe('15');
    // The wedge burns at that power, as the photo does.
    expect(toneWedgeOptions(draft, seed).operation).toMatchObject({ power: 15, minPower: 5 });
  });

  it('seeds the power an artwork override sets, scaled the same way', () => {
    selectPhoto({ power: 60 }, { powerScale: 50, operationOverride: { power: 40 } });
    expect(openedSeed()?.settings.power).toBe(20);
  });

  it('seeds the operation power unchanged without a multiplier', () => {
    selectPhoto({ power: 60, minPower: 20 }, {});
    expect(openedSeed()?.settings).toMatchObject({ power: 60, minPower: 20 });
  });

  it('shows a rounded power but keeps the exact one while the field is unchanged', () => {
    selectPhoto({ power: 0.7 }, { powerScale: 33 });
    const seed = openedSeed()!;
    const exact = (0.7 * 33) / 100;
    expect(seed.settings.power).toBe(exact);
    const draft = seededToneWedgeDraft(seed, DEFAULT_TONE_WEDGE_DRAFT);
    expect(draft.power).toBe('0.23');
    expect(toneWedgeSettings(draft, seed).power).toBe(exact);
    expect(toneWedgeSettings({ ...draft, power: '0.5' }, seed).power).toBe(0.5);
  });
});
