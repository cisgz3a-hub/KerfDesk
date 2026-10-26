// ADR-670: saved photo tone calibrations on this computer. A project keeps its
// own copy of a chosen curve on the photo's operation, so it burns the same on
// any computer; this list only offers curves to choose from.

import { create } from 'zustand';
import { DITHER_ALGORITHMS, type DitherAlgorithm } from '../../core/scene';
import {
  isPhotoToneCurve,
  type PhotoToneCurve,
  type PhotoToneSample,
} from '../../core/raster/photo-tone-curve';

/** The wedge's burn settings, for the "measured with" note and mismatch warning. */
export type ToneCalibrationSettings = {
  readonly ditherAlgorithm: DitherAlgorithm;
  readonly linesPerMm: number;
  readonly power: number;
  readonly speed: number;
  readonly negativeImage: boolean;
};

export type ToneCalibrationRecord = {
  readonly id: string;
  readonly curve: PhotoToneCurve;
  readonly savedAt: string;
  readonly settings: ToneCalibrationSettings;
  readonly samples: ReadonlyArray<PhotoToneSample>;
};

export const TONE_CALIBRATIONS_KEY = 'laserforge.photoToneCalibrations.v1';
const SCHEMA_VERSION = 1;
const MAX_RECORDS = 50;

export function readToneCalibrations(): ReadonlyArray<ToneCalibrationRecord> {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(TONE_CALIBRATIONS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed['schemaVersion'] !== SCHEMA_VERSION) return [];
    const records = parsed['records'];
    return Array.isArray(records) ? records.filter(isToneCalibrationRecord) : [];
  } catch {
    return [];
  }
}

function writeToneCalibrations(records: ReadonlyArray<ToneCalibrationRecord>): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(
      TONE_CALIBRATIONS_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, records }),
    );
    return true;
  } catch {
    return false;
  }
}

export const useToneCalibrationLibrary = create<{
  readonly records: ReadonlyArray<ToneCalibrationRecord>;
  /** Newest first; a record with the same label replaces the older one. */
  readonly save: (record: ToneCalibrationRecord) => boolean;
  readonly remove: (id: string) => void;
}>((set, get) => ({
  records: readToneCalibrations(),
  save: (record) => {
    const records = [
      record,
      ...get().records.filter((existing) => existing.curve.label !== record.curve.label),
    ].slice(0, MAX_RECORDS);
    set({ records });
    return writeToneCalibrations(records);
  },
  remove: (id) => {
    const records = get().records.filter((record) => record.id !== id);
    set({ records });
    writeToneCalibrations(records);
  },
}));

/** What differs between the wedge's settings and the photo's: each changes the response. */
export function toneCalibrationMismatches(
  measured: ToneCalibrationSettings,
  photo: Pick<ToneCalibrationSettings, 'ditherAlgorithm' | 'linesPerMm' | 'negativeImage'> &
    Partial<Pick<ToneCalibrationSettings, 'power' | 'speed'>>,
): ReadonlyArray<string> {
  const out: string[] = [];
  if (measured.ditherAlgorithm !== photo.ditherAlgorithm) out.push('photo processing');
  if (Math.abs(measured.linesPerMm - photo.linesPerMm) > 1e-6) out.push('DPI');
  if (measured.negativeImage !== photo.negativeImage) out.push('material marking');
  if (photo.power !== undefined && Math.abs(measured.power - photo.power) > 1e-6) out.push('power');
  if (photo.speed !== undefined && Math.abs(measured.speed - photo.speed) > 1e-6) out.push('speed');
  return out;
}

function isToneCalibrationRecord(value: unknown): value is ToneCalibrationRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['savedAt'] === 'string' &&
    isPhotoToneCurve(value['curve']) &&
    isSettings(value['settings']) &&
    Array.isArray(value['samples']) &&
    value['samples'].every(isSample)
  );
}

function isSettings(value: unknown): value is ToneCalibrationSettings {
  return (
    isRecord(value) &&
    DITHER_ALGORITHMS.some((algorithm) => algorithm === value['ditherAlgorithm']) &&
    isPositive(value['linesPerMm']) &&
    typeof value['power'] === 'number' &&
    Number.isFinite(value['power']) &&
    isPositive(value['speed']) &&
    typeof value['negativeImage'] === 'boolean'
  );
}

function isSample(value: unknown): value is PhotoToneSample {
  return (
    isRecord(value) &&
    typeof value['commandedPercent'] === 'number' &&
    Number.isFinite(value['commandedPercent']) &&
    typeof value['observedPercent'] === 'number' &&
    Number.isFinite(value['observedPercent'])
  );
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
