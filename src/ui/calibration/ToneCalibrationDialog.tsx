import { useState } from 'react';
import type { ToneWedgeOptions } from '../../core/job/tone-calibration-wedge';
import { toneWedgeCommandedPercents } from '../../core/job/tone-calibration-wedge';
import { fitPhotoToneCurve, PHOTO_TONE_LABEL_MAX_LENGTH } from '../../core/raster/photo-tone-curve';
import { Button, Dialog, DialogActions } from '../kit';
import { ditherLabel } from '../layers/DitherSwatchPicker';
import { persistCalibrationDraft, restoreCalibrationDraft } from './calibration-draft-storage';
import {
  DEFAULT_TONE_WEDGE_DRAFT,
  describeToneSettings,
  readLastToneWedge,
  seededToneWedgeDraft,
  TONE_WEDGE_DRAFT_FIELDS,
  TONE_WEDGE_DRAFT_KEY,
  toneWedgeDraftIssues,
  toneWedgeOptions,
  toneWedgeSettings,
  type ToneCalibrationSeed,
  type ToneWedgeDraft,
  type ToneWedgeRecordTarget,
} from './tone-calibration-draft';
import type { ToneCalibrationRecord } from './tone-calibration-library';
import type { ToneCalibrationStep } from './tone-calibration-store';
import { initialToneRecord, ToneRecordStep, type ToneRecordDraft } from './ToneRecordStep';
import { ToneWedgeStep } from './ToneWedgeStep';
import './tone-calibration.css';

export function ToneCalibrationDialog(props: {
  readonly initialStep: ToneCalibrationStep;
  readonly seed: ToneCalibrationSeed | null;
  readonly onClose: () => void;
  readonly onGenerate: (options: ToneWedgeOptions, target: ToneWedgeRecordTarget) => void;
  readonly onSave: (record: ToneCalibrationRecord) => void;
}): JSX.Element {
  const [step, setStep] = useState(props.initialStep);
  const [draft, setDraft] = useState<ToneWedgeDraft>(() => initialWedgeDraft(props.seed));
  const target = readLastToneWedge() ?? draftTarget(draft, props.seed);
  const [record, setRecord] = useState<ToneRecordDraft>(() => initialToneRecord(target.patchCount));
  const currentRecord =
    record.patchCount === target.patchCount ? record : initialToneRecord(target.patchCount);
  const wedgeIssues = toneWedgeDraftIssues(draft);
  const recordIssue = currentRecord.material.trim() === '' ? 'Name the material.' : null;
  const issues = step === 'generate' ? wedgeIssues : recordIssue === null ? [] : [recordIssue];
  return (
    <Dialog
      title="Tone Calibration"
      size="lg"
      panelClassName="lf-tone-calibration"
      onClose={props.onClose}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (issues.length > 0) return;
        if (step === 'generate') {
          persistCalibrationDraft(TONE_WEDGE_DRAFT_KEY, draft);
          props.onGenerate(toneWedgeOptions(draft, props.seed), draftTarget(draft, props.seed));
        } else {
          props.onSave(toneCalibrationRecord(target, currentRecord));
        }
      }}
    >
      <div className="lf-tone-calibration__steps" role="tablist" aria-label="Tone calibration step">
        <StepTab step="generate" current={step} onSelect={setStep}>
          1. Burn the wedge
        </StepTab>
        <StepTab step="record" current={step} onSelect={setStep}>
          2. Record the result
        </StepTab>
      </div>
      <div
        role="tabpanel"
        aria-label={step === 'generate' ? 'Burn the wedge' : 'Record the result'}
      >
        {step === 'generate' ? (
          <ToneWedgeStep
            draft={draft}
            seed={props.seed}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        ) : (
          <ToneRecordStep
            target={target}
            record={currentRecord}
            onChange={(update) =>
              setRecord((current) =>
                update(
                  current.patchCount === target.patchCount
                    ? current
                    : initialToneRecord(target.patchCount),
                ),
              )
            }
          />
        )}
      </div>
      {issues.length > 0 ? <p role="alert">{issues.join(' ')}</p> : null}
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={issues.length > 0}>
          {step === 'generate' ? 'Generate wedge' : 'Save calibration'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const STEP_TITLES: Readonly<Record<ToneCalibrationStep, string>> = {
  generate: 'Make the grey step wedge and burn it with your photo settings',
  record: 'Record how dark each burned patch came out',
};

function StepTab(props: {
  readonly step: ToneCalibrationStep;
  readonly current: ToneCalibrationStep;
  readonly onSelect: (step: ToneCalibrationStep) => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const selected = props.step === props.current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={STEP_TITLES[props.step]}
      className={`lf-tone-calibration__step${selected ? ' is-selected' : ''}`}
      onClick={() => props.onSelect(props.step)}
    >
      {props.children}
    </button>
  );
}

function initialWedgeDraft(seed: ToneCalibrationSeed | null): ToneWedgeDraft {
  const stored = restoreCalibrationDraft(
    TONE_WEDGE_DRAFT_KEY,
    DEFAULT_TONE_WEDGE_DRAFT,
    TONE_WEDGE_DRAFT_FIELDS,
  );
  return seed === null ? stored : seededToneWedgeDraft(seed, stored);
}

function draftTarget(
  draft: ToneWedgeDraft,
  seed: ToneCalibrationSeed | null,
): ToneWedgeRecordTarget {
  const count = Number(draft.patchCount);
  return {
    patchCount: Number.isInteger(count) && count >= 6 && count <= 21 ? count : 11,
    settings: toneWedgeSettings(draft, seed),
  };
}

function toneCalibrationRecord(
  target: ToneWedgeRecordTarget,
  record: ToneRecordDraft,
): ToneCalibrationRecord {
  const commanded = toneWedgeCommandedPercents(target.patchCount);
  const samples = commanded.map((commandedPercent, index) => ({
    commandedPercent,
    observedPercent: record.observed[index] ?? commandedPercent,
  }));
  const label = `${record.material.trim()} · ${describeToneSettings(target.settings, ditherLabel)}`;
  return {
    id: crypto.randomUUID(),
    curve: fitPhotoToneCurve(samples, label.slice(0, PHOTO_TONE_LABEL_MAX_LENGTH)),
    savedAt: new Date().toISOString(),
    settings: target.settings,
    samples,
  };
}
