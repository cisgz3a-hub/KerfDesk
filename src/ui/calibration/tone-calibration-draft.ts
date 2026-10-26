// ADR-670: the Tone Calibration dialog's editable text and what it parses to.

import {
  TONE_WEDGE_DEFAULT_PATCHES,
  TONE_WEDGE_MAX_GAP_MM,
  TONE_WEDGE_MAX_PATCHES,
  TONE_WEDGE_MAX_PATCH_MM,
  TONE_WEDGE_MIN_PATCHES,
  TONE_WEDGE_MIN_PATCH_MM,
  type ToneWedgeOptions,
} from '../../core/job/tone-calibration-wedge';
import { dpiToLinesPerMm, linesPerMmToDpi } from '../../core/raster';
import {
  captureLayerOperationSettings,
  DITHER_ALGORITHMS,
  LAYER_DEFAULTS,
  type DitherAlgorithm,
  type LayerOperationSettings,
} from '../../core/scene';
import { PHOTO_DITHERS } from '../raster/photo-engraving-settings';
import type { ToneCalibrationSettings } from './tone-calibration-library';

/** The photo settings a wedge starts from, and where they came from. */
export type ToneCalibrationSeed = {
  readonly sourceName: string;
  readonly settings: LayerOperationSettings;
};

export type ToneWedgeDraft = {
  readonly patchCount: string;
  readonly patchSizeMm: string;
  readonly gapMm: string;
  readonly ditherAlgorithm: string;
  readonly dpi: string;
  readonly power: string;
  readonly speed: string;
  readonly marking: string;
};

export const TONE_WEDGE_DRAFT_KEY = 'laserforge.calibration.toneWedgeDraft.v1';
export const TONE_WEDGE_DRAFT_FIELDS = [
  'patchCount',
  'patchSizeMm',
  'gapMm',
  'ditherAlgorithm',
  'dpi',
  'power',
  'speed',
  'marking',
] as const satisfies ReadonlyArray<keyof ToneWedgeDraft>;

export const DEFAULT_TONE_WEDGE_DRAFT: ToneWedgeDraft = {
  patchCount: String(TONE_WEDGE_DEFAULT_PATCHES),
  patchSizeMm: '8',
  gapMm: '1',
  ditherAlgorithm: 'jarvis',
  dpi: '254',
  power: '30',
  speed: '3000',
  marking: 'dark',
};

/** The dithers offered for a wedge: the photo ones, Grayscale, and the seed's own. */
export function toneWedgeDithers(seed: ToneCalibrationSeed | null): ReadonlyArray<DitherAlgorithm> {
  const offered: DitherAlgorithm[] = [...PHOTO_DITHERS, 'grayscale'];
  const own = seed?.settings.ditherAlgorithm;
  return own !== undefined && !offered.includes(own) ? [...offered, own] : offered;
}

export function formatDpi(linesPerMm: number): string {
  return String(Number(linesPerMmToDpi(linesPerMm).toFixed(2)));
}

export function seededToneWedgeDraft(
  seed: ToneCalibrationSeed,
  stored: ToneWedgeDraft,
): ToneWedgeDraft {
  return {
    ...stored,
    ditherAlgorithm: seed.settings.ditherAlgorithm,
    dpi: formatDpi(seed.settings.linesPerMm),
    power: String(seed.settings.power),
    speed: String(seed.settings.speed),
    marking: seed.settings.negativeImage ? 'light' : 'dark',
  };
}

export function toneWedgeDraftIssues(draft: ToneWedgeDraft): ReadonlyArray<string> {
  return [
    rangeIssue('Patches', draft.patchCount, TONE_WEDGE_MIN_PATCHES, TONE_WEDGE_MAX_PATCHES, true),
    rangeIssue('Patch size', draft.patchSizeMm, TONE_WEDGE_MIN_PATCH_MM, TONE_WEDGE_MAX_PATCH_MM),
    rangeIssue('Gap', draft.gapMm, 0, TONE_WEDGE_MAX_GAP_MM),
    rangeIssue('DPI', draft.dpi, 25, 2540),
    rangeIssue('Power', draft.power, 0.01, 100),
    rangeIssue('Speed', draft.speed, 1, Number.POSITIVE_INFINITY),
  ].filter((issue): issue is string => issue !== null);
}

function rangeIssue(
  label: string,
  text: string,
  min: number,
  max: number,
  integer = false,
): string | null {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value)) return `${label}: enter a number.`;
  if (integer && !Number.isInteger(value)) return `${label}: enter a whole number.`;
  if (value < min) return `${label}: enter ${min} or greater.`;
  if (value > max) return `${label}: enter ${max} or less.`;
  return null;
}

/** The burn settings of a valid draft; an unchanged DPI keeps the seed's exact interval. */
export function toneWedgeSettings(
  draft: ToneWedgeDraft,
  seed: ToneCalibrationSeed | null,
): ToneCalibrationSettings {
  const seededDpi = seed === null ? null : formatDpi(seed.settings.linesPerMm);
  const ditherAlgorithm = DITHER_ALGORITHMS.find((value) => value === draft.ditherAlgorithm);
  return {
    ditherAlgorithm: ditherAlgorithm ?? 'jarvis',
    linesPerMm:
      seed !== null && draft.dpi.trim() === seededDpi
        ? seed.settings.linesPerMm
        : dpiToLinesPerMm(Number(draft.dpi)),
    power: Number(draft.power),
    speed: Number(draft.speed),
    negativeImage: draft.marking === 'light',
  };
}

/** Wedge options: the seed's whole operation, with the dialog's settings over it. */
export function toneWedgeOptions(
  draft: ToneWedgeDraft,
  seed: ToneCalibrationSeed | null,
): ToneWedgeOptions {
  const base =
    seed?.settings ?? captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'image' });
  return {
    patchCount: Number(draft.patchCount),
    patchSizeMm: Number(draft.patchSizeMm),
    gapMm: Number(draft.gapMm),
    operation: { ...base, ...toneWedgeSettings(draft, seed), mode: 'image', passThrough: false },
  };
}

/** The wedge last generated here: what the Record step asks about. */
export type ToneWedgeRecordTarget = {
  readonly patchCount: number;
  readonly settings: ToneCalibrationSettings;
};

export const LAST_TONE_WEDGE_KEY = 'laserforge.calibration.lastToneWedge.v1';

export function readLastToneWedge(): ToneWedgeRecordTarget | null {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_TONE_WEDGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ToneWedgeRecordTarget>;
    const count = parsed.patchCount;
    const settings = parsed.settings;
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < TONE_WEDGE_MIN_PATCHES ||
      count > TONE_WEDGE_MAX_PATCHES ||
      typeof settings !== 'object' ||
      settings === null ||
      !DITHER_ALGORITHMS.includes(settings.ditherAlgorithm)
    )
      return null;
    return { patchCount: count, settings };
  } catch {
    return null;
  }
}

export function writeLastToneWedge(target: ToneWedgeRecordTarget): void {
  try {
    localStorage.setItem(LAST_TONE_WEDGE_KEY, JSON.stringify(target));
  } catch {
    // The Record step then starts from the dialog's current settings instead.
  }
}

/** Short "Jarvis · 254 DPI · 30% · 3000 mm/min · dark marks" description. */
export function describeToneSettings(
  settings: ToneCalibrationSettings,
  ditherName: (algorithm: DitherAlgorithm) => string,
): string {
  return [
    ditherName(settings.ditherAlgorithm),
    `${formatDpi(settings.linesPerMm)} DPI`,
    `${settings.power}%`,
    `${settings.speed} mm/min`,
    settings.negativeImage ? 'light marks' : 'dark marks',
  ].join(' · ');
}
