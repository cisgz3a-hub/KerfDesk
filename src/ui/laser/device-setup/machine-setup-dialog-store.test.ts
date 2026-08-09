import { afterEach, describe, expect, it } from 'vitest';
import {
  closeMachineSetup,
  machineSetupHighlight,
  machineSetupInitialStep,
  openMachineSetup,
  useMachineSetupDialogStore,
} from './machine-setup-dialog-store';

afterEach(() => {
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('global Machine Setup dialog requests', () => {
  it('maps every CNC field to the dedicated Startup Setup page', () => {
    const target = { kind: 'cnc', field: 'spindle-max' } as const;
    expect(machineSetupInitialStep(target)).toBe('cnc-setup');
    expect(machineSetupHighlight(target)).toBeUndefined();
    openMachineSetup(target);
    expect(useMachineSetupDialogStore.getState().state).toEqual({
      kind: 'open',
      target,
      requestId: 1,
    });
  });

  it('retains existing generic step and highlight requests', () => {
    const target = { kind: 'step', step: 'options', highlight: 'autofocus' } as const;
    expect(machineSetupInitialStep(target)).toBe('options');
    expect(machineSetupHighlight(target)).toBe('autofocus');
    openMachineSetup(target);
    closeMachineSetup();
    expect(useMachineSetupDialogStore.getState().state).toEqual({ kind: 'idle' });
  });

  it('gives repeated requests new identities so the draft reinitializes', () => {
    openMachineSetup({ kind: 'cnc', field: 'stock' });
    openMachineSetup({ kind: 'cnc', field: 'stock' });
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({ requestId: 2 });
  });
});
