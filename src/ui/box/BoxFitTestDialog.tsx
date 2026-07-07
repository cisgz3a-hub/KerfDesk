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
import {
  persistCalibrationDraft,
  restoreCalibrationDraft,
} from '../calibration/calibration-draft-storage';
import type { BoxMachineContext } from './box-draft';
import { BoxFitTestFields } from './BoxFitTestFields';
import {
  defaultFitTestDraft,
  FIT_TEST_DRAFT_KEY,
  FIT_TEST_PERSISTED_FIELDS,
  type FitTestDraft,
} from './fit-test-draft';

export type FitCouponParts = Extract<FitCouponResult, { kind: 'generated' }>['parts'];

export function BoxFitTestDialog(props: {
  readonly machine: BoxMachineContext;
  readonly onCancel: () => void;
  readonly onGenerate: (parts: FitCouponParts) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(
      FIT_TEST_DRAFT_KEY,
      defaultFitTestDraft(props.machine),
      FIT_TEST_PERSISTED_FIELDS,
    ),
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
      <BoxFitTestFields draft={draft} machine={props.machine} setField={setField} />
      <p style={hintStyle}>
        Cut both strips, press each rung together, and enter the best rung’s clearance (start + rung
        × step, counted from the narrow-margin end) in the Box Generator.
      </p>
      <FitTestIssues result={result} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={result.kind !== 'generated'}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FitTestIssues(props: { readonly result: FitCouponResult }): JSX.Element | null {
  const { result } = props;
  if (result.kind === 'invalid') {
    return (
      <div role="alert" style={issueBlockStyle}>
        {result.issues.map((issue) => (
          <p key={issue.message} style={issueStyle}>
            {issue.message}
          </p>
        ))}
      </div>
    );
  }
  if (result.kind === 'error') {
    return (
      <p role="alert" style={issueStyle}>
        {result.message}
      </p>
    );
  }
  return null;
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '8px 0 4px',
};
const issueBlockStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const issueStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-danger-fg)', margin: 0 };
