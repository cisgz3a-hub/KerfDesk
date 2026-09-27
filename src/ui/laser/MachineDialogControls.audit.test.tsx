import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../../core/scene';
import { IntervalTestDialog } from '../calibration/IntervalTestDialog';
import { MaterialTestDialog } from '../calibration/MaterialTestDialog';
import { ScanOffsetCalibrationDialog } from '../calibration/ScanOffsetCalibrationDialog';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { LabsSettingsDialog } from './LabsSettingsDialog';
import { OptimizationSettingsDialog } from './OptimizationSettingsDialog';
import { PrintAndCutDialog } from './PrintAndCutDialog';
import { RotarySetupDialog } from './RotarySetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useExperimentalLaserFeatures.getState().resetFeatures();
  localStorage.clear();
});
function button(text: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}
function check(selector: string): HTMLInputElement {
  const result = host.querySelector<HTMLInputElement>(selector);
  if (!result) throw new Error(`Missing checkbox: ${selector}`);
  return result;
}

describe('Machine dialog control audit', () => {
  it.each([
    ['interval', IntervalTestDialog],
    ['material', MaterialTestDialog],
    ['scan offset', ScanOffsetCalibrationDialog],
  ] as const)('%s Cancel calls only cancellation without generating a job', (_name, Dialog) => {
    const onCancel = vi.fn();
    const onGenerate = vi.fn();
    act(() =>
      root.render(<Dialog onCancel={onCancel} onGenerate={onGenerate} maxFeedMmPerMin={1000} />),
    );
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('Print and Cut captures each target, applies the reviewed pair, disables and cancels independently', () => {
    const onCapture = vi.fn();
    const onApply = vi.fn();
    const onDisable = vi.fn();
    const onCancel = vi.fn();
    const initialTargets = { first: { x: 0, y: 0 }, second: { x: 100, y: 0 } };
    const props = {
      initialTargets,
      firstMachinePoint: { x: 20, y: 30 },
      secondMachinePoint: { x: 120, y: 30 },
      captureEnabled: true,
      onCapture,
      onApply,
      onDisable,
      onCancel,
    };
    act(() => root.render(<PrintAndCutDialog {...props} />));
    const captures = [...host.querySelectorAll('button')].filter(
      (node) => node.textContent === 'Capture head',
    );
    expect(captures).toHaveLength(2);
    act(() => {
      captures[0]!.click();
      captures[1]!.click();
    });
    expect(onCapture.mock.calls).toEqual([['first'], ['second']]);
    act(() => button('Apply registration').click());
    expect(onApply).toHaveBeenCalledWith(initialTargets);
    act(() => button('Disable').click());
    expect(onDisable).toHaveBeenCalledTimes(1);
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => root.render(<PrintAndCutDialog {...props} captureEnabled={false} />));
    for (const capture of captures) {
      expect(capture.disabled).toBe(true);
      act(() => capture.click());
    }
    expect(onCapture).toHaveBeenCalledTimes(2);
  });

  it('rotary type and reverse toggles are saved only by Apply and Cancel does not apply a draft', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const onGenerateCalibration = vi.fn();
    act(() =>
      root.render(
        <RotarySetupDialog
          setup={{ enabled: false, type: 'chuck', objectDiameterMm: 60, mmPerRotation: 360 }}
          onApply={onApply}
          onCancel={onCancel}
          onGenerateCalibration={onGenerateCalibration}
        />,
      ),
    );
    act(() => button('Roller').click());
    expect(button('Roller').getAttribute('aria-pressed')).toBe('true');
    expect(check('[aria-label="Rotary millimetres per rotation"]').disabled).toBe(true);
    act(() => button('Chuck').click());
    expect(button('Chuck').getAttribute('aria-pressed')).toBe('true');
    expect(check('[aria-label="Rotary millimetres per rotation"]').disabled).toBe(false);
    const toggles = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    act(() => {
      toggles[0]!.click();
      toggles[1]!.click();
    });
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(onGenerateCalibration).not.toHaveBeenCalled();
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({
      enabled: true,
      type: 'chuck',
      objectDiameterMm: 60,
      mmPerRotation: 360,
      reverseAxis: true,
    });
  });

  it('Cut Planner edits inside-first, applies that value by button and cancels without applying again', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    act(() =>
      root.render(
        <OptimizationSettingsDialog
          settings={{
            ...DEFAULT_PROJECT_OPTIMIZATION,
            travelPolicy: 'nearest-neighbor',
            insideFirst: true,
          }}
          onApply={onApply}
          onCancel={onCancel}
        />,
      ),
    );
    act(() => check('[name="insideFirst"]').click());
    expect(check('[name="insideFirst"]').checked).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ insideFirst: false, reduceTravelMoves: true }),
    );
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('Labs toggles each remaining feature, persists them, resets all, and Done closes', () => {
    const onClose = vi.fn();
    act(() => root.render(<LabsSettingsDialog onClose={onClose} />));
    const toggles = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) act(() => toggle.click());
    expect(useExperimentalLaserFeatures.getState().features).toEqual({
      lowPowerFire: true,
      printAndCut: true,
    });
    expect(localStorage.getItem('kerfdesk.experimental-laser-features.v1')).toContain(
      '"printAndCut":true',
    );
    act(() => button('Reset all').click());
    expect(useExperimentalLaserFeatures.getState().features).toEqual({
      lowPowerFire: false,
      printAndCut: false,
    });
    expect(toggles.every((toggle) => !toggle.checked)).toBe(true);
    act(() => button('Done').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
