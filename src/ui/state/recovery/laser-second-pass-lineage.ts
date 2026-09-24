import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import type { LaserSecondPassWriterVersion } from '../../../core/laser-second-pass/types';
import type { LaserResumeTransformVersion } from '../../../core/controllers/grbl/resume-program';
import { isLaserResumeTransformVersion } from '../../../core/controllers/grbl/laser-resume-reentry';
import { fingerprintsEqual, type GcodeFingerprint } from '../../../core/recovery';

/** One recorded laser resume. `version` names the resume transform that built
 * its bytes; a step saved before transforms were versioned omits it and was
 * built by transform 1 (ADR-341 Amendment 3). */
export type LaserResumeStep = {
  readonly fromLine: number;
  readonly version?: LaserResumeTransformVersion;
};

/** Each stage consumes the previous stage's exact output after its recorded
 * recovery transforms. Later recovery transforms remain outside this chain. */
export type LaserSecondPassStage = {
  readonly sourceRunId: string;
  readonly sourceFingerprint: GcodeFingerprint;
  readonly resumeChainBefore: ReadonlyArray<LaserResumeStep>;
  readonly selection: LaserSecondPassSelection;
  /** Painted-pass writer that built this stage; absent means writer 1. */
  readonly writerVersion?: LaserSecondPassWriterVersion;
};

export type LaserSecondPassChain = ReadonlyArray<LaserSecondPassStage>;

export function isLaserSecondPassChain(value: unknown): value is LaserSecondPassChain {
  return Array.isArray(value) && value.length > 0 && value.every(isStage);
}

export function isLaserResumeStep(value: unknown): value is LaserResumeStep {
  if (!isRecord(value)) return false;
  const version = value['version'];
  return (
    Number.isSafeInteger(value['fromLine']) &&
    Number(value['fromLine']) > 0 &&
    (version === undefined || isLaserResumeTransformVersion(version))
  );
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
        resumeChainKey(stage.resumeChainBefore) === resumeChainKey(other.resumeChainBefore) &&
        (stage.writerVersion ?? 1) === (other.writerVersion ?? 1) &&
        selectionKey(stage.selection) === selectionKey(other.selection)
      );
    })
  );
}

/** Compares resume chains by what they build: an unversioned step is transform 1. */
export function resumeChainKey(chain: ReadonlyArray<LaserResumeStep>): string {
  return JSON.stringify(chain.map((step) => [step.fromLine, step.version ?? 1]));
}

/** Retention key and Frame execution signature of a painted pass: the exact
 * source run plus the exact selection, so a permit names the bytes it authorizes. */
export function laserSecondPassExecutionSignature(
  sourceRunId: string,
  selection: LaserSecondPassSelection,
): string {
  return `laser-second-pass:${sourceRunId}:${selectionKey(selection)}`;
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
  const writer = value['writerVersion'];
  return (
    typeof source === 'string' &&
    source.length > 0 &&
    source.length <= 200 &&
    isFingerprint(value['sourceFingerprint']) &&
    Array.isArray(resume) &&
    resume.every(isLaserResumeStep) &&
    (writer === undefined || writer === 1 || writer === 2) &&
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
