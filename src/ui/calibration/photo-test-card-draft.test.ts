import { afterEach, describe, expect, it } from 'vitest';
import {
  captureLayerOperationSettings,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type RasterImage,
} from '../../core/scene';
import {
  DEFAULT_PHOTO_TEST_CARD_DRAFT,
  LAST_PHOTO_TEST_CARD_KEY,
  photoTestCardOptions,
  photoTestDraftIssues,
  photoTestPlacement,
  photoTestSourceShape,
  photoTestWindowOptions,
  readLastPhotoTestCard,
  seededPhotoTestDraft,
  writeLastPhotoTestCard,
  type PhotoTestCardRecord,
  type PhotoTestSeed,
} from './photo-test-card-draft';
import {
  photoTestMismatches,
  photoTestResultLabel,
  PHOTO_TEST_RESULTS_KEY,
  readPhotoTestResults,
  usePhotoTestLibrary,
  type PhotoTestResult,
} from './photo-test-library';

const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'portrait',
  source: 'portrait.png',
  lumaBase64: btoa(String.fromCharCode(0, 96, 255, 255, 96, 0)),
  pixelWidth: 3,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
  transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 },
  color: '#808080',
  dither: 'blue-noise',
  linesPerMm: 10,
};

function seed(power: number, speed: number, image: RasterImage = IMAGE): PhotoTestSeed {
  return {
    sourceName: image.source,
    image,
    settings: {
      ...captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'image' }),
      ditherAlgorithm: 'blue-noise',
      linesPerMm: 10,
      negativeImage: true,
      power,
      speed,
    },
    tones: { brightness: 4, contrast: 10, gamma: 0.9 },
  };
}

const PROCESSING = { ditherAlgorithm: 'blue-noise', linesPerMm: 10, negativeImage: true } as const;

afterEach(() => {
  localStorage.removeItem(LAST_PHOTO_TEST_CARD_KEY);
  localStorage.removeItem(PHOTO_TEST_RESULTS_KEY);
  usePhotoTestLibrary.setState({ results: [] });
});

describe('ADR-711 photo test card draft', () => {
  it("centres the ranges on the photo's own power and speed", () => {
    const draft = seededPhotoTestDraft(seed(40, 3000), DEFAULT_PHOTO_TEST_CARD_DRAFT, 6000);
    expect(draft).toMatchObject({
      powerMin: '20',
      powerMax: '60',
      speedMin: '1500',
      speedMax: '4500',
      // The layout fields keep what was stored.
      columns: '4',
      rows: '3',
      cellSizeMm: '15',
    });
    expect(photoTestDraftIssues(draft)).toEqual([]);
  });

  it('keeps the ranges inside full power and the machine top feed', () => {
    const draft = seededPhotoTestDraft(seed(90, 5000), DEFAULT_PHOTO_TEST_CARD_DRAFT, 6000);
    expect(draft).toMatchObject({ powerMin: '45', powerMax: '100', speedMax: '6000' });
    const tiny = seededPhotoTestDraft(seed(0.5, 1), DEFAULT_PHOTO_TEST_CARD_DRAFT, undefined);
    expect(photoTestDraftIssues(tiny)).toEqual([]);
  });

  it('names each field that cannot make a card', () => {
    expect(
      photoTestDraftIssues({
        ...DEFAULT_PHOTO_TEST_CARD_DRAFT,
        columns: '2.5',
        rows: '9',
        powerMax: '120',
        speedMin: '',
        cellSizeMm: '2',
        centreY: '140',
      }),
    ).toEqual([
      'Powers across: enter a whole number.',
      'Speeds down: enter 8 or less.',
      'Highest power: enter 100 or less.',
      'Slowest speed: enter a number.',
      'Square size: enter 5 or greater.',
      'Down the photo: enter 100 or less.',
    ]);
  });

  it('reads the placed size and mirroring from the photo', () => {
    expect(photoTestSourceShape(IMAGE)).toEqual({
      pixelWidth: 3,
      pixelHeight: 2,
      widthMm: 60,
      heightMm: 40,
    });
    expect(photoTestPlacement(IMAGE).mirror).toEqual({ x: false, y: false });
    const mirrored = { ...IMAGE, transform: { ...IMAGE.transform, mirrorX: true, scaleY: -2 } };
    expect(photoTestPlacement(mirrored)).toMatchObject({
      widthMm: 60,
      heightMm: 40,
      mirror: { x: true, y: true },
    });
  });

  it('builds card options that burn with the photo settings and tones', () => {
    const from = seed(40, 3000);
    const draft = { ...DEFAULT_PHOTO_TEST_CARD_DRAFT, centreX: '25', centreY: '75', gapMm: '3' };
    expect(photoTestWindowOptions(draft, from)).toEqual({
      centre: { x: 0.25, y: 0.75 },
      sizeMm: 15,
      linesPerMm: 10,
    });
    const patch = {
      luma: new Uint8Array(4),
      pixelWidth: 2,
      pixelHeight: 2,
      widthMm: 15,
      heightMm: 15,
    };
    const options = photoTestCardOptions({ draft, seed: from, patch, maxFeedMmPerMin: 6000 });
    expect(options).toMatchObject({
      rows: 3,
      columns: 4,
      powerMin: 15,
      powerMax: 45,
      speedMin: 1500,
      speedMax: 4500,
      gapMm: 3,
      maxFeedMmPerMin: 6000,
      patch,
      tones: { brightness: 4, contrast: 10, gamma: 0.9 },
      operation: { mode: 'image', ditherAlgorithm: 'blue-noise', negativeImage: true, power: 40 },
    });
  });

  it('remembers the last card for the Pick step and refuses a damaged one', () => {
    expect(readLastPhotoTestCard()).toBeNull();
    const record: PhotoTestCardRecord = {
      sourceName: 'portrait.png',
      powers: [20, 40, 60],
      speeds: [4500, 3000],
      processing: PROCESSING,
    };
    writeLastPhotoTestCard(record);
    expect(readLastPhotoTestCard()).toEqual(record);
    for (const damaged of [
      { ...record, powers: [] },
      { ...record, powers: [20, 140] },
      { ...record, speeds: [0] },
      { ...record, processing: { ...PROCESSING, ditherAlgorithm: 'sparkle' } },
      { ...record, sourceName: 7 },
    ]) {
      localStorage.setItem(LAST_PHOTO_TEST_CARD_KEY, JSON.stringify(damaged));
      expect(readLastPhotoTestCard()).toBeNull();
    }
    localStorage.setItem(LAST_PHOTO_TEST_CARD_KEY, '{not json');
    expect(readLastPhotoTestCard()).toBeNull();
  });
});

describe('ADR-711 photo test results on this computer', () => {
  function result(material: string, power: number, speed: number): PhotoTestResult {
    return {
      id: `${material}-${power}-${speed}`,
      label: photoTestResultLabel(material, power, speed),
      power,
      speed,
      savedAt: '2026-11-13T00:00:00.000Z',
      processing: PROCESSING,
    };
  }

  it('labels a result with its material, power and speed', () => {
    expect(photoTestResultLabel('  Black slate ', 62.5, 2000)).toBe(
      'Black slate · 62.5% · 2000 mm/min',
    );
  });

  it('saves newest first, replaces the same label and survives a reload', () => {
    const library = usePhotoTestLibrary.getState();
    expect(library.save(result('Slate', 60, 2000))).toBe(true);
    expect(library.save(result('Granite', 80, 1500))).toBe(true);
    expect(library.save({ ...result('Slate', 60, 2000), id: 'again' })).toBe(true);
    expect(usePhotoTestLibrary.getState().results.map((saved) => saved.id)).toEqual([
      'again',
      'Granite-80-1500',
    ]);
    expect(readPhotoTestResults().map((saved) => saved.label)).toEqual([
      'Slate · 60% · 2000 mm/min',
      'Granite · 80% · 1500 mm/min',
    ]);
    usePhotoTestLibrary.getState().remove('again');
    expect(readPhotoTestResults()).toHaveLength(1);
  });

  it('drops stored results that could not burn', () => {
    localStorage.setItem(
      PHOTO_TEST_RESULTS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        results: [
          result('Slate', 60, 2000),
          { ...result('Zero', 60, 2000), power: 0 },
          { ...result('Over', 60, 2000), power: 101 },
          { ...result('Still', 60, 2000), speed: 0 },
          { ...result('Text', 60, 2000), speed: '2000' },
          { id: 'bare' },
        ],
      }),
    );
    expect(readPhotoTestResults().map((saved) => saved.label)).toEqual([
      'Slate · 60% · 2000 mm/min',
    ]);
    localStorage.setItem(PHOTO_TEST_RESULTS_KEY, JSON.stringify({ schemaVersion: 2, results: [] }));
    expect(readPhotoTestResults()).toEqual([]);
  });

  it('names what changed since the card burned', () => {
    expect(photoTestMismatches(PROCESSING, PROCESSING)).toEqual([]);
    expect(
      photoTestMismatches(PROCESSING, {
        ditherAlgorithm: 'jarvis',
        linesPerMm: 12,
        negativeImage: false,
      }),
    ).toEqual(['photo processing', 'DPI', 'material marking']);
  });
});
