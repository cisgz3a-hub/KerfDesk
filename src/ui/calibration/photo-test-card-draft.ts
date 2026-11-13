// ADR-711: the Photo Test Card dialog's editable text and what it parses to.

import {
  PHOTO_TEST_MAX_COUNT,
  PHOTO_TEST_MAX_GAP_MM,
  PHOTO_TEST_MIN_COUNT,
  type PhotoTestCardOptions,
  type PhotoTestTones,
} from '../../core/job/photo-test-card';
import type {
  PhotoTestPatch,
  PhotoTestSource,
  PhotoTestWindowOptions,
} from '../../core/job/photo-test-patch';
import type { LayerOperationSettings, RasterImage } from '../../core/scene';
import { isPositiveFiniteNumber } from '../../core/util/finite';
import { isRecord } from '../../core/util/is-record';
import {
  isPhotoTestProcessing,
  isTestedPower,
  type PhotoTestProcessing,
} from './photo-test-library';

/** The photo a card is cut from, and the settings its squares burn with. */
export type PhotoTestSeed = {
  readonly sourceName: string;
  /** Stored pixels and placement. */
  readonly image: RasterImage;
  /** The photo's effective operation at the power it burns with. */
  readonly settings: LayerOperationSettings;
  readonly tones: PhotoTestTones;
};

export type PhotoTestCardDraft = {
  readonly columns: string;
  readonly rows: string;
  readonly powerMin: string;
  readonly powerMax: string;
  readonly speedMin: string;
  readonly speedMax: string;
  readonly cellSizeMm: string;
  readonly gapMm: string;
  /** Centre of the piece, in percent across and down the photo. */
  readonly centreX: string;
  readonly centreY: string;
};

export const PHOTO_TEST_CARD_DRAFT_KEY = 'laserforge.calibration.photoTestCardDraft.v1';
export const PHOTO_TEST_CARD_DRAFT_FIELDS = [
  'columns',
  'rows',
  'powerMin',
  'powerMax',
  'speedMin',
  'speedMax',
  'cellSizeMm',
  'gapMm',
  'centreX',
  'centreY',
] as const satisfies ReadonlyArray<keyof PhotoTestCardDraft>;

export const PHOTO_TEST_MIN_CELL_MM = 5;
export const PHOTO_TEST_MAX_CELL_MM = 50;

export const DEFAULT_PHOTO_TEST_CARD_DRAFT: PhotoTestCardDraft = {
  columns: '4',
  rows: '3',
  powerMin: '15',
  powerMax: '45',
  speedMin: '1500',
  speedMax: '4500',
  cellSizeMm: '15',
  gapMm: '2',
  centreX: '50',
  // A portrait's eyes sit above its middle.
  centreY: '40',
};

/**
 * Ranges centred on the photo's own power and speed: half to one and a half
 * times each, inside what the machine can run. The layout fields keep what
 * the operator last used.
 */
export function seededPhotoTestDraft(
  seed: PhotoTestSeed,
  stored: PhotoTestCardDraft,
  maxFeedMmPerMin: number | undefined,
): PhotoTestCardDraft {
  const { power, speed } = seed.settings;
  const feedCeiling =
    maxFeedMmPerMin !== undefined && maxFeedMmPerMin > 0
      ? maxFeedMmPerMin
      : Number.POSITIVE_INFINITY;
  return {
    ...stored,
    powerMin: String(Math.max(1, Math.round(power / 2))),
    powerMax: String(Math.min(100, Math.max(2, Math.round(power * 1.5)))),
    speedMin: String(Math.max(1, Math.round(speed / 2))),
    speedMax: String(Math.max(2, Math.round(Math.min(feedCeiling, speed * 1.5)))),
  };
}

type Range = {
  readonly key: keyof PhotoTestCardDraft;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
};

const RANGES: ReadonlyArray<Range> = [
  {
    key: 'columns',
    label: 'Powers across',
    min: PHOTO_TEST_MIN_COUNT,
    max: PHOTO_TEST_MAX_COUNT,
    integer: true,
  },
  {
    key: 'rows',
    label: 'Speeds down',
    min: PHOTO_TEST_MIN_COUNT,
    max: PHOTO_TEST_MAX_COUNT,
    integer: true,
  },
  { key: 'powerMin', label: 'Lowest power', min: 0.01, max: 100 },
  { key: 'powerMax', label: 'Highest power', min: 0.01, max: 100 },
  { key: 'speedMin', label: 'Slowest speed', min: 1, max: Number.POSITIVE_INFINITY },
  { key: 'speedMax', label: 'Fastest speed', min: 1, max: Number.POSITIVE_INFINITY },
  {
    key: 'cellSizeMm',
    label: 'Square size',
    min: PHOTO_TEST_MIN_CELL_MM,
    max: PHOTO_TEST_MAX_CELL_MM,
  },
  { key: 'gapMm', label: 'Gap', min: 0, max: PHOTO_TEST_MAX_GAP_MM },
  { key: 'centreX', label: 'Across the photo', min: 0, max: 100 },
  { key: 'centreY', label: 'Down the photo', min: 0, max: 100 },
];

export function photoTestDraftIssues(draft: PhotoTestCardDraft): ReadonlyArray<string> {
  return RANGES.map((range) => rangeIssue(range, draft[range.key])).filter(
    (issue): issue is string => issue !== null,
  );
}

function rangeIssue(range: Range, text: string): string | null {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value)) return `${range.label}: enter a number.`;
  if (range.integer === true && !Number.isInteger(value))
    return `${range.label}: enter a whole number.`;
  if (value < range.min) return `${range.label}: enter ${range.min} or greater.`;
  if (value > range.max) return `${range.label}: enter ${range.max} or less.`;
  return null;
}

/** The photo's placed size and whether it is mirrored on the canvas. */
export function photoTestPlacement(image: RasterImage): {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mirror: { readonly x: boolean; readonly y: boolean };
} {
  const { transform, bounds } = image;
  return {
    widthMm: (bounds.maxX - bounds.minX) * Math.abs(transform.scaleX),
    heightMm: (bounds.maxY - bounds.minY) * Math.abs(transform.scaleY),
    mirror: {
      x: transform.scaleX < 0 !== transform.mirrorX,
      y: transform.scaleY < 0 !== transform.mirrorY,
    },
  };
}

/** The photo's stored grid at its placed size, without the pixels. */
export function photoTestSourceShape(image: RasterImage): Omit<PhotoTestSource, 'luma'> {
  const { widthMm, heightMm } = photoTestPlacement(image);
  return {
    pixelWidth: Math.max(1, Math.floor(image.pixelWidth)),
    pixelHeight: Math.max(1, Math.floor(image.pixelHeight)),
    widthMm,
    heightMm,
  };
}

/** Where a valid draft cuts the piece from. */
export function photoTestWindowOptions(
  draft: PhotoTestCardDraft,
  seed: PhotoTestSeed,
): PhotoTestWindowOptions {
  return {
    centre: { x: Number(draft.centreX) / 100, y: Number(draft.centreY) / 100 },
    sizeMm: Number(draft.cellSizeMm),
    linesPerMm: seed.settings.linesPerMm,
  };
}

/** A valid draft's ranges, in either order. */
export function photoTestRanges(
  draft: PhotoTestCardDraft,
): Pick<
  PhotoTestCardOptions,
  'rows' | 'columns' | 'speedMin' | 'speedMax' | 'powerMin' | 'powerMax'
> {
  return {
    rows: Number(draft.rows),
    columns: Number(draft.columns),
    speedMin: Number(draft.speedMin),
    speedMax: Number(draft.speedMax),
    powerMin: Number(draft.powerMin),
    powerMax: Number(draft.powerMax),
  };
}

export function photoTestCardOptions(args: {
  readonly draft: PhotoTestCardDraft;
  readonly seed: PhotoTestSeed;
  readonly patch: PhotoTestPatch;
  readonly maxFeedMmPerMin: number | undefined;
}): PhotoTestCardOptions {
  const { draft, seed } = args;
  return {
    ...photoTestRanges(draft),
    ...(args.maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin: args.maxFeedMmPerMin }),
    gapMm: Number(draft.gapMm),
    patch: args.patch,
    operation: { ...seed.settings, mode: 'image', passThrough: false },
    tones: seed.tones,
  };
}

export function photoTestProcessing(settings: LayerOperationSettings): PhotoTestProcessing {
  return {
    ditherAlgorithm: settings.ditherAlgorithm,
    linesPerMm: settings.linesPerMm,
    negativeImage: settings.negativeImage,
  };
}

/** The card last generated here: what the Pick step shows. */
export type PhotoTestCardRecord = {
  readonly sourceName: string;
  /** Column powers in percent, lowest first. */
  readonly powers: ReadonlyArray<number>;
  /** Row speeds as the job ran them, fastest first. */
  readonly speeds: ReadonlyArray<number>;
  readonly processing: PhotoTestProcessing;
};

export const LAST_PHOTO_TEST_CARD_KEY = 'laserforge.calibration.lastPhotoTestCard.v1';

export function readLastPhotoTestCard(): PhotoTestCardRecord | null {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_PHOTO_TEST_CARD_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isPhotoTestCardRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastPhotoTestCard(record: PhotoTestCardRecord): void {
  try {
    localStorage.setItem(LAST_PHOTO_TEST_CARD_KEY, JSON.stringify(record));
  } catch {
    // The Pick step then has no card to show and says so.
  }
}

function isPhotoTestCardRecord(value: unknown): value is PhotoTestCardRecord {
  return (
    isRecord(value) &&
    typeof value['sourceName'] === 'string' &&
    isAxis(value['powers'], isTestedPower) &&
    isAxis(value['speeds'], isPositiveFiniteNumber) &&
    isPhotoTestProcessing(value['processing'])
  );
}

function isAxis(value: unknown, isValue: (entry: unknown) => boolean): boolean {
  return (
    Array.isArray(value) &&
    value.length >= PHOTO_TEST_MIN_COUNT &&
    value.length <= PHOTO_TEST_MAX_COUNT &&
    value.every(isValue)
  );
}
