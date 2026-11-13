// ADR-711: the power and speed picked from burned Photo Test Cards on this
// computer. Applying one writes plain power and speed into the photo's own
// settings, so a project burns the same anywhere; this list only offers them.

import { create } from 'zustand';
import { formatGcodeFeedMmPerMin } from '../../core/gcode/feed-word';
import { DITHER_ALGORITHMS, type DitherAlgorithm } from '../../core/scene';
import { isPositiveFiniteNumber } from '../../core/util/finite';
import { isRecord } from '../../core/util/is-record';
import { formatUpTo2Decimals } from '../../core/util/number-format';

/** The photo processing the card burned with: a different one changes the look. */
export type PhotoTestProcessing = {
  readonly ditherAlgorithm: DitherAlgorithm;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
};

export type PhotoTestResult = {
  readonly id: string;
  /** "Slate · 60% · 2000 mm/min", as the Photo engraving list shows it. */
  readonly label: string;
  /** Burn power in percent, as the picked square ran it. */
  readonly power: number;
  /** Feed in mm/min, as the picked square ran it. */
  readonly speed: number;
  readonly savedAt: string;
  readonly processing: PhotoTestProcessing;
};

export const PHOTO_TEST_RESULTS_KEY = 'laserforge.photoTestResults.v1';
export const PHOTO_TEST_MATERIAL_MAX_LENGTH = 60;
const SCHEMA_VERSION = 1;
const MAX_RESULTS = 50;

export function photoTestResultLabel(material: string, power: number, speed: number): string {
  return `${material.trim().slice(0, PHOTO_TEST_MATERIAL_MAX_LENGTH)} · ${describeBurn(power, speed)}`;
}

/** "60% · 2000 mm/min" */
export function describeBurn(power: number, speed: number): string {
  return `${formatUpTo2Decimals(power)}% · ${formatGcodeFeedMmPerMin(speed)} mm/min`;
}

export function readPhotoTestResults(): ReadonlyArray<PhotoTestResult> {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(PHOTO_TEST_RESULTS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed['schemaVersion'] !== SCHEMA_VERSION) return [];
    const results = parsed['results'];
    return Array.isArray(results) ? results.filter(isPhotoTestResult) : [];
  } catch {
    return [];
  }
}

function writePhotoTestResults(results: ReadonlyArray<PhotoTestResult>): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(
      PHOTO_TEST_RESULTS_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, results }),
    );
    return true;
  } catch {
    return false;
  }
}

export const usePhotoTestLibrary = create<{
  readonly results: ReadonlyArray<PhotoTestResult>;
  /** Newest first; a result with the same label replaces the older one. */
  readonly save: (result: PhotoTestResult) => boolean;
  readonly remove: (id: string) => void;
}>((set, get) => ({
  results: readPhotoTestResults(),
  save: (result) => {
    const results = [
      result,
      ...get().results.filter((existing) => existing.label !== result.label),
    ].slice(0, MAX_RESULTS);
    set({ results });
    return writePhotoTestResults(results);
  },
  remove: (id) => {
    const results = get().results.filter((result) => result.id !== id);
    set({ results });
    writePhotoTestResults(results);
  },
}));

/** What differs between the card's photo processing and the photo's now. */
export function photoTestMismatches(
  tested: PhotoTestProcessing,
  photo: PhotoTestProcessing,
): ReadonlyArray<string> {
  const out: string[] = [];
  if (tested.ditherAlgorithm !== photo.ditherAlgorithm) out.push('photo processing');
  if (Math.abs(tested.linesPerMm - photo.linesPerMm) > 1e-6) out.push('DPI');
  if (tested.negativeImage !== photo.negativeImage) out.push('material marking');
  return out;
}

export function isPhotoTestProcessing(value: unknown): value is PhotoTestProcessing {
  return (
    isRecord(value) &&
    DITHER_ALGORITHMS.some((algorithm) => algorithm === value['ditherAlgorithm']) &&
    isPositiveFiniteNumber(value['linesPerMm']) &&
    typeof value['negativeImage'] === 'boolean'
  );
}

export function isTestedPower(value: unknown): value is number {
  return isPositiveFiniteNumber(value) && value <= 100;
}

function isPhotoTestResult(value: unknown): value is PhotoTestResult {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['label'] === 'string' &&
    typeof value['savedAt'] === 'string' &&
    isTestedPower(value['power']) &&
    isPositiveFiniteNumber(value['speed']) &&
    isPhotoTestProcessing(value['processing'])
  );
}
