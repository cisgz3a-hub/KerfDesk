// The edit draft behind a Job Review laser operation card (ADR-224 v3).
// Edit copies the four core numbers into text fields; Save turns them back
// into one store patch with the same limits the panels use — power 0–100 %
// (the grayscale floor follows it down, the PowerInput co-clamp rule), speed
// 1 mm/min up to the profile's Output max feed, whole passes from 1 — and
// carries only the fields that changed.

import type { LayerOperationSettings } from '../../../core/scene';
import { parseEnglishDecimalInput } from '../../layers/english-decimal-input';
import type { ReviewRowPatch } from './job-review-operation-edit';

const PERCENT_MAX = 100;
const MIN_SPEED_MM_PER_MIN = 1;
const MIN_PASSES = 1;

export const REVIEW_NUMBER_ERROR = 'Use digits and a decimal point, like 12.5.';

type CoreSettings = Pick<
  LayerOperationSettings,
  'power' | 'minPower' | 'speed' | 'passes' | 'airAssist'
>;

export type LaserOperationDraft = {
  readonly power: string;
  readonly speed: string;
  readonly passes: string;
  readonly airAssist: boolean;
};

export type DraftNumberField = 'power' | 'speed' | 'passes';

export type DraftSaveResult =
  | {
      readonly ok: true;
      readonly patch: ReviewRowPatch;
      /** The speed asked for when Output max feed capped it, else null. */
      readonly cappedSpeed: number | null;
    }
  | { readonly ok: false; readonly invalid: ReadonlyArray<DraftNumberField> };

export function draftFromSettings(settings: CoreSettings): LaserOperationDraft {
  return {
    power: String(settings.power),
    speed: String(settings.speed),
    passes: String(settings.passes),
    airAssist: settings.airAssist,
  };
}

export function saveLaserOperationDraft(
  draft: LaserOperationDraft,
  settings: CoreSettings,
  maxFeedMmPerMin: number,
): DraftSaveResult {
  const power = parseEnglishDecimalInput(draft.power);
  const speed = parseEnglishDecimalInput(draft.speed);
  const passes = parseEnglishDecimalInput(draft.passes);
  if (power === null || speed === null || passes === null) {
    const invalid: DraftNumberField[] = [];
    if (power === null) invalid.push('power');
    if (speed === null) invalid.push('speed');
    if (passes === null) invalid.push('passes');
    return { ok: false, invalid };
  }
  const nextPower = clamp(power, 0, PERCENT_MAX);
  const nextSpeed = clamp(speed, MIN_SPEED_MM_PER_MIN, maxFeedMmPerMin);
  const next: CoreSettings = {
    power: nextPower,
    minPower: Math.min(settings.minPower, nextPower),
    speed: nextSpeed,
    passes: Math.max(MIN_PASSES, Math.floor(passes)),
    airAssist: draft.airAssist,
  };
  return {
    ok: true,
    patch: changedFields(settings, next),
    cappedSpeed: speed > maxFeedMmPerMin ? speed : null,
  };
}

function changedFields(before: CoreSettings, after: CoreSettings): ReviewRowPatch {
  const patch: Record<string, number | boolean> = {};
  for (const field of ['power', 'minPower', 'speed', 'passes', 'airAssist'] as const) {
    if (after[field] !== before[field]) patch[field] = after[field];
  }
  return patch as ReviewRowPatch;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
