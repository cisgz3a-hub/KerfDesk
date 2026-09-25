import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RotarySetup } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { RotarySetupDialog } from './RotarySetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

let host: HTMLDivElement;
let root: Root;
let onApply: Mock<(setup: RotarySetup) => void>;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onApply = vi.fn<(setup: RotarySetup) => void>();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderDialog(setup: RotarySetup): void {
  act(() =>
    root.render(
      <RotarySetupDialog
        setup={setup}
        onCancel={vi.fn()}
        onApply={onApply}
        onGenerateCalibration={vi.fn()}
      />,
    ),
  );
}

function input(label: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`Missing input: ${label}`);
  return found;
}

function checkbox(label: string): HTMLInputElement {
  const found = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (node) => node.title === label,
  );
  if (found === undefined) throw new Error(`Missing checkbox: ${label}`);
  return found;
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native value setter not found');
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function preview(): string {
  return host.querySelector('[aria-label="Rotary wrap preview"]')?.textContent ?? '';
}

describe('Rotary Setup roller diameter (ADR-373)', () => {
  it('leaves a surface-calibrated roller unscaled and Motion per turn unused', () => {
    renderDialog(LEGACY_ROLLER);
    expect(input('Rotary millimetres per rotation').disabled).toBe(true);
    expect(preview()).toContain('Y scale: ×1.0000 (Y moves the surface directly)');
    expect(preview()).toContain('Machine travel per revolution: 188.50 mm');
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith(LEGACY_ROLLER);
    expect(onApply.mock.calls[0]?.[0]).not.toHaveProperty('rollerDiameterMm');
  });

  it('scales Y from the roller diameter and shows the scale and wrap limit', () => {
    renderDialog(LEGACY_ROLLER);
    act(() => checkbox('Scale Y from the roller diameter').click());
    expect(input('Rotary roller diameter').value).toBe('25');
    expect(input('Rotary millimetres per rotation').disabled).toBe(false);
    type(input('Rotary millimetres per rotation'), '40');
    expect(preview()).toContain('Y scale: ×0.5093 machine mm per surface mm');
    expect(preview()).toContain('Machine travel per revolution: 96.00 mm');
    expect(preview()).toContain('Wrap limit: artwork up to 188.50 mm tall fits one revolution');
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({
      ...LEGACY_ROLLER,
      mmPerRotation: 40,
      rollerDiameterMm: 25,
    });
  });

  it('remembers the roller diameter when scaling is switched off and on', () => {
    renderDialog({ ...LEGACY_ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 });
    type(input('Rotary roller diameter'), '31.5');
    act(() => checkbox('Scale Y from the roller diameter').click());
    expect(host.querySelector('input[aria-label="Rotary roller diameter"]')).toBeNull();
    act(() => checkbox('Scale Y from the roller diameter').click());
    expect(input('Rotary roller diameter').value).toBe('31.5');
  });

  it('keeps the roller diameter out of a chuck setup', () => {
    renderDialog({ ...LEGACY_ROLLER, mmPerRotation: 40, rollerDiameterMm: 25 });
    act(() => button('Chuck').click());
    expect(host.querySelector('input[aria-label="Rotary roller diameter"]')).toBeNull();
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({ ...LEGACY_ROLLER, type: 'chuck', mmPerRotation: 40 });
    expect(onApply.mock.calls[0]?.[0]).not.toHaveProperty('rollerDiameterMm');
  });
});

describe('Rotary Setup object size', () => {
  it('links the circumference and the diameter both ways', () => {
    renderDialog(LEGACY_ROLLER);
    expect(input('Rotary object circumference').value).toBe('188.496');
    type(input('Rotary object circumference'), '188.5');
    expect(input('Rotary object diameter').value).toBe('60.001');
    expect(input('Rotary object circumference').value).toBe('188.5');
    type(input('Rotary object diameter'), '50');
    expect(input('Rotary object circumference').value).toBe('157.08');
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({ ...LEGACY_ROLLER, objectDiameterMm: 50 });
  });

  it('measures the diameter from a strip wrapped once round the part', () => {
    renderDialog(LEGACY_ROLLER);
    act(() => button('Measure with a strip…').click());
    expect(host.textContent).toContain('Diameter: Ø60 mm');
    type(input('Measured wrap length'), '200');
    type(input('Strip thickness'), '0.2');
    const expected = Math.round((200 / Math.PI - 0.2) * 1000) / 1000;
    expect(host.textContent).toContain(`Diameter: Ø${expected} mm`);
    act(() => button('Use this diameter').click());
    expect(host.querySelector('[aria-label="Measure the object with a strip"]')).toBeNull();
    expect(input('Rotary object diameter').value).toBe(String(expected));
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({ ...LEGACY_ROLLER, objectDiameterMm: expected });
  });
});
