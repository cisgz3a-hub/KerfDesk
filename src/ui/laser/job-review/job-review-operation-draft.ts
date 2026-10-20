// The edit draft behind a Job Review laser operation card (ADR-224 v3).
// Edit copies the four core numbers into text fields; Save turns them back
// into one store patch with the same limits the panels use — power 0–100 %
// (the grayscale floor follows it down, the PowerInput co-clamp rule), speed
// 1 mm/min up to the profile's Output max feed, whole passes from 1 — and
// carries only the fields that changed. A field whose text is as Edit showed
// it keeps its stored value untouched, so Save never rewrites (or re-clamps) a
// value nobody changed: a speed stored above a since-lowered Output max feed
// stays as it is when only Power was edited (ADR-638 Amendment 1).

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
  /** The fields as Edit showed them; by default, the current settings. */
  shown: LaserOperationDraft = draftFromSettings(settings),
): DraftSaveResult {
  const edited = (field: DraftNumberField): boolean => draft[field] !== shown[field];
  const read = (field: DraftNumberField): number | null =>
    edited(field) ? parseEnglishDecimalInput(draft[field]) : settings[field];
  const power = read('power');
  const speed = read('speed');
  const passes = read('passes');
  if (power === null || speed === null || passes === null) {
    const invalid: DraftNumberField[] = [];
    if (power === null) invalid.push('power');
    if (speed === null) invalid.push('speed');
    if (passes === null) invalid.push('passes');
    return { ok: false, invalid };
  }
  // Only an edited field takes the panels' limits.
  const limit = (field: DraftNumberField, value: number, bound: (input: number) => number) =>
    edited(field) ? bound(value) : value;
  const nextPower = limit('power', power, (input) => clamp(input, 0, PERCENT_MAX));
  const speedCapped = edited('speed') && speed > maxFeedMmPerMin;
  const next: CoreSettings = {
    power: nextPower,
    minPower: edited('power') ? Math.min(settings.minPower, nextPower) : settings.minPower,
    speed: limit('speed', speed, (input) => clamp(input, MIN_SPEED_MM_PER_MIN, maxFeedMmPerMin)),
    passes: limit('passes', passes, (input) => Math.max(MIN_PASSES, Math.floor(input))),
    airAssist: draft.airAssist,
  };
  return {
    ok: true,
    patch: changedFields(settings, next),
    cappedSpeed: speedCapped ? speed : null,
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
