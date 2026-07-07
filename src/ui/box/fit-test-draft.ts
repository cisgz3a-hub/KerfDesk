// fit-test-draft — the Box Fit Test dialog's string-draft model (ADR-119):
// draft shape, persistence key and field list, and machine-aware defaults.
// Split from BoxFitTestDialog for the component-size cap, mirroring
// box-draft.ts.

import type { BoxMachineContext } from './box-draft';

export type FitTestDraft = {
  readonly thickness: string;
  readonly fingerWidth: string;
  readonly start: string;
  readonly step: string;
  readonly rungs: string;
  readonly toolDiameter: string;
};

export const FIT_TEST_DRAFT_KEY = 'laserforge.box.fitTestDraft.v1';

// The tool diameter always mirrors the machine (never persisted).
export const FIT_TEST_PERSISTED_FIELDS: ReadonlyArray<keyof FitTestDraft> = [
  'thickness',
  'fingerWidth',
  'start',
  'step',
  'rungs',
];

export function defaultFitTestDraft(machine: BoxMachineContext): FitTestDraft {
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
