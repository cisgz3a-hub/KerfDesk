// BoxFitTestDialog — the Box Fit Test coupon form (ADR-119, F-K8):
// calibration-dialog conventions, machine-aware defaults, live core
// validation. Generates the tab comb + slot strip whose winning rung IS
// the clearance to type into the Box Generator.

import { useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  generateFitCoupon,
  type BoxRelief,
  type FitCouponResult,
  type FitCouponSpec,
} from '../../core/box';
import { Button, Dialog, DialogActions } from '../kit';
import { CalibrationNumberField } from '../calibration/CalibrationNumberField';
import {
  persistCalibrationDraft,
  restoreCalibrationDraft,
} from '../calibration/calibration-draft-storage';
import type { BoxMachineContext } from './box-draft';

type FitTestDraft = {
  readonly thickness: string;
  readonly fingerWidth: string;
  readonly start: string;
  readonly step: string;
  readonly rungs: string;
  readonly toolDiameter: string;
};

const FIT_TEST_DRAFT_KEY = 'laserforge.box.fitTestDraft.v1';
// The tool diameter always mirrors the machine (never persisted).
const PERSISTED: ReadonlyArray<keyof FitTestDraft> = [
  'thickness',
  'fingerWidth',
  'start',
  'step',
  'rungs',
];

function defaults(machine: BoxMachineContext): FitTestDraft {
  const thickness = machine.kind === 'cnc' ? machine.stockThicknessMm : 3;
  return {
    thickness: String(thickness),
    fingerWidth: String(thickness * 3),
    start: '0.05',
    step: '0.05',
    rungs: '6',
    toolDiameter: machine.kind === 'cnc' ? String(machine.toolDiameterMm) : '',
  };
}

export type FitCouponParts = Extract<FitCouponResult, { kind: 'generated' }>['parts'];

export function BoxFitTestDialog(props: {
  readonly machine: BoxMachineContext;
  readonly onCancel: () => void;
  readonly onGenerate: (parts: FitCouponParts) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(FIT_TEST_DRAFT_KEY, defaults(props.machine), PERSISTED),
  );
  const setField =
    (field: keyof FitTestDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };
  const relief: BoxRelief =
    props.machine.kind === 'cnc'
      ? { kind: 'corner-overcut', toolDiameterMm: Number(draft.toolDiameter) }
      : { kind: 'none' };
  const spec: FitCouponSpec = {
    thicknessMm: Number(draft.thickness),
    fingerWidthMm: Number(draft.fingerWidth),
    startClearanceMm: Number(draft.start),
    stepClearanceMm: Number(draft.step),
    rungCount: Number(draft.rungs),
    relief,
  };
  const result = generateFitCoupon(spec);
  return (
    <Dialog
      onClose={props.onCancel}
      title="Box Fit Test"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (result.kind !== 'generated') return;
        persistCalibrationDraft(FIT_TEST_DRAFT_KEY, draft);
        props.onGenerate(result.parts);
      }}
      size="sm"
    >
      <div style={gridStyle}>
        <CalibrationNumberField
          label="Material thickness (mm)"
          value={draft.thickness}
          min={0.1}
          max={undefined}
          step="any"
          onChange={setField('thickness')}
        />
        <CalibrationNumberField
          label="Finger width"
          value={draft.fingerWidth}
          min={0.5}
          max={undefined}
          step="any"
          onChange={setField('fingerWidth')}
        />
        <CalibrationNumberField
          label="Ladder start"
          value={draft.start}
          min={0}
          max={undefined}
          step="any"
          onChange={setField('start')}
        />
        <CalibrationNumberField
          label="Ladder step"
          value={draft.step}
          min={0.01}
          max={undefined}
          step="any"
          onChange={setField('step')}
        />
        <CalibrationNumberField
          label="Rungs"
          value={draft.rungs}
          min={2}
          max={12}
          step={1}
          onChange={setField('rungs')}
        />
        {props.machine.kind === 'cnc' ? (
          <CalibrationNumberField
            label="Relief tool diameter"
            value={draft.toolDiameter}
            min={0.1}
            max={undefined}
            step="any"
            onChange={setField('toolDiameter')}
          />
        ) : null}
      </div>
      <p style={hintStyle}>
        Cut both strips, press each rung together, and enter the best rung’s clearance
        (start + rung × step, counted from the narrow-margin end) in the Box Generator.
      </p>
      {result.kind === 'invalid' ? (
        <div role="alert" style={issueBlockStyle}>
          {result.issues.map((issue) => (
            <p key={issue.message} style={issueStyle}>
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
      {result.kind === 'error' ? (
        <p role="alert" style={issueStyle}>
          {result.message}
        </p>
      ) : null}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={result.kind !== 'generated'}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 };
const hintStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)', margin: '8px 0 4px' };
const issueBlockStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const issueStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-danger-fg)', margin: 0 };
