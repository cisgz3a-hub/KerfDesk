import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import { fingerprintsEqual, type GcodeFingerprint } from '../../../core/recovery';

/** Each stage consumes the previous stage's exact output after its recorded
 * recovery transforms. Later recovery transforms remain outside this chain. */
export type LaserSecondPassStage = {
  readonly sourceRunId: string;
  readonly sourceFingerprint: GcodeFingerprint;
  readonly resumeChainBefore: ReadonlyArray<{ readonly fromLine: number }>;
  readonly selection: LaserSecondPassSelection;
};

export type LaserSecondPassChain = ReadonlyArray<LaserSecondPassStage>;

export function isLaserSecondPassChain(value: unknown): value is LaserSecondPassChain {
  return Array.isArray(value) && value.length > 0 && value.every(isStage);
}

export function laserSecondPassChainsEqual(
  left: LaserSecondPassChain | undefined,
  right: LaserSecondPassChain | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.length === right.length &&
    left.every((stage, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        stage.sourceRunId === other.sourceRunId &&
        fingerprintsEqual(stage.sourceFingerprint, other.sourceFingerprint) &&
        JSON.stringify(stage.resumeChainBefore.map((step) => step.fromLine)) ===
          JSON.stringify(other.resumeChainBefore.map((step) => step.fromLine)) &&
        selectionKey(stage.selection) === selectionKey(other.selection)
      );
    })
  );
}

export function selectionKey(selection: LaserSecondPassSelection): string {
  return JSON.stringify([
    selection.version,
    selection.maxPowerS,
    selection.initialPosition === undefined
      ? null
      : [selection.initialPosition.x, selection.initialPosition.y],
    selection.strokes.map((stroke) => [
      stroke.id,
      stroke.mode,
      stroke.radiusMm,
      stroke.powerScale,
      stroke.points.map((point) => [point.x, point.y]),
    ]),
  ]);
}

function isStage(value: unknown): value is LaserSecondPassStage {
  if (!isRecord(value)) return false;
  const source = value['sourceRunId'];
  const resume = value['resumeChainBefore'];
  return (
    typeof source === 'string' &&
    source.length > 0 &&
    source.length <= 200 &&
    isFingerprint(value['sourceFingerprint']) &&
    Array.isArray(resume) &&
    resume.every(isResumeStep) &&
    isSelection(value['selection'])
  );
}

function isFingerprint(value: unknown): value is GcodeFingerprint {
  if (!isRecord(value)) return false;
  return (
    ['fnv1a', 'chars', 'lines'].every(
      (key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0,
    ) &&
    Number(value['fnv1a']) <= 0xffffffff &&
    Number(value['lines']) > 0
  );
}

function isResumeStep(value: unknown): boolean {
  return (
    isRecord(value) && Number.isSafeInteger(value['fromLine']) && Number(value['fromLine']) > 0
  );
}

function isSelection(value: unknown): value is LaserSecondPassSelection {
  if (!isRecord(value)) return false;
  return (
    value['version'] === 1 &&
    isPositive(value['maxPowerS']) &&
    Array.isArray(value['strokes']) &&
    value['strokes'].length > 0 &&
    value['strokes'].every(isStroke) &&
    (value['initialPosition'] === undefined || isPoint(value['initialPosition']))
  );
}

function isStroke(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    (value['mode'] === 'paint' || value['mode'] === 'erase') &&
    isPositive(value['radiusMm']) &&
    isNonNegative(value['powerScale']) &&
    Array.isArray(value['points']) &&
    value['points'].length > 0 &&
    value['points'].every(isPoint)
  );
}

function isPoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['x'] === 'number' &&
    Number.isFinite(value['x']) &&
    typeof value['y'] === 'number' &&
    Number.isFinite(value['y'])
  );
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
