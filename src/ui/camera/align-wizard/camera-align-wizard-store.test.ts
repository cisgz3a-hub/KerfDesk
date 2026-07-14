import { beforeEach, describe, expect, it } from 'vitest';
import { useCameraAlignWizardStore } from './camera-align-wizard-store';

beforeEach(() => {
  useCameraAlignWizardStore.getState().closeWizard();
});

describe('camera-align-wizard-store', () => {
  it('opens on the setup step and close resets the step', () => {
    const store = useCameraAlignWizardStore.getState();
    store.setStep({ kind: 'clear-bed' });
    store.openWizard();
    expect(useCameraAlignWizardStore.getState().open).toBe(true);
    expect(useCameraAlignWizardStore.getState().step).toEqual({ kind: 'setup', note: null });
    useCameraAlignWizardStore.getState().setStep({ kind: 'done', basis: 'raw' });
    useCameraAlignWizardStore.getState().closeWizard();
    expect(useCameraAlignWizardStore.getState().open).toBe(false);
    expect(useCameraAlignWizardStore.getState().step).toEqual({ kind: 'setup', note: null });
  });

  it('minimize toggles and is cleared on open/close', () => {
    const store = useCameraAlignWizardStore.getState();
    store.openWizard();
    expect(useCameraAlignWizardStore.getState().minimized).toBe(false);
    store.toggleMinimized();
    expect(useCameraAlignWizardStore.getState().minimized).toBe(true);
    store.closeWizard();
    expect(useCameraAlignWizardStore.getState().minimized).toBe(false);
  });

  it('clamps engrave settings to sane bounds (and rejects NaN)', () => {
    const store = useCameraAlignWizardStore.getState();
    store.setPowerPercent(250);
    expect(useCameraAlignWizardStore.getState().powerPercent).toBe(100);
    store.setPowerPercent(-3);
    expect(useCameraAlignWizardStore.getState().powerPercent).toBe(1);
    store.setPowerPercent(Number.NaN);
    expect(useCameraAlignWizardStore.getState().powerPercent).toBe(1);
    store.setSpeedMmPerMin(50);
    expect(useCameraAlignWizardStore.getState().speedMmPerMin).toBe(100);
    store.setSpeedMmPerMin(99999);
    expect(useCameraAlignWizardStore.getState().speedMmPerMin).toBe(20000);
    store.setPlaneHeightMm(6.35);
    expect(useCameraAlignWizardStore.getState().planeHeightMm).toBe(6.35);
    store.setPlaneHeightMm(-1);
    expect(useCameraAlignWizardStore.getState().planeHeightMm).toBe(0);
  });

  it('walks the burn path: setup → burning → clear-bed → detect → done', () => {
    const store = useCameraAlignWizardStore.getState();
    store.openWizard();
    store.setStep({ kind: 'burning' });
    expect(useCameraAlignWizardStore.getState().step.kind).toBe('burning');
    store.setStep({ kind: 'clear-bed' });
    store.setStep({ kind: 'detect', status: { kind: 'idle' } });
    store.setStep({ kind: 'done', basis: 'rectified' });
    expect(useCameraAlignWizardStore.getState().step).toEqual({
      kind: 'done',
      basis: 'rectified',
    });
  });
});
