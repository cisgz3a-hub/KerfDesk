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

// ADR-694: LightBurn's Taper Warp inputs in Rotary Setup.
const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
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
        artwork={{ widthMm: 20, heightMm: 230 }}
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

describe('Rotary Setup tapered part (ADR-694)', () => {
  it('starts off, and says what an untapered wrap does to a narrowing part', () => {
    renderDialog(CHUCK);
    expect(checkbox('Tapered part (Taper Warp)').checked).toBe(false);
    expect(host.querySelector('[aria-label="Tapered part"]')).toBeNull();
    expect(host.textContent).toContain('shorter where the part is narrower');
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith(CHUCK);
  });

  it('takes both ends, the length, the top side and the gap, and saves them', () => {
    renderDialog(CHUCK);
    act(() => checkbox('Tapered part (Taper Warp)').click());
    expect(
      host.querySelector('[aria-label="Tapered part on the rotary, side view"]'),
    ).not.toBeNull();
    expect(input('Taper top diameter').value).toBe('80');
    type(input('Taper bottom diameter'), '70');
    type(input('Taper length'), '110');
    act(() => button('Right').click());
    type(input('Taper artwork from top'), '10');
    expect(input('Rotary object diameter').disabled).toBe(true);
    expect(preview()).toContain(
      'one turn is 251.33 mm round the top and 219.91 mm round the bottom',
    );
    act(() => button('Apply').click());
    expect(onApply).toHaveBeenCalledWith({
      ...CHUCK,
      taper: {
        enabled: true,
        topDiameterMm: 80,
        bottomDiameterMm: 70,
        lengthMm: 110,
        topSide: 'right',
        artworkFromTopMm: 10,
      },
    });
  });

  it('keeps Object diameter on the wider end, as LightBurn advises', () => {
    renderDialog(CHUCK);
    act(() => checkbox('Tapered part (Taper Warp)').click());
    type(input('Taper bottom diameter'), '90');
    expect(input('Rotary object diameter').value).toBe('90');
    act(() => checkbox('Tapered part (Taper Warp)').click());
    expect(input('Rotary object diameter').disabled).toBe(false);
    act(() => button('Apply').click());
    const applied = onApply.mock.calls[0]?.[0];
    expect(applied?.objectDiameterMm).toBe(90);
    expect(applied?.taper).toMatchObject({ enabled: false, bottomDiameterMm: 90 });
  });

  it('checks the wrap where the part is narrowest under the artwork', () => {
    renderDialog(CHUCK);
    act(() => checkbox('Tapered part (Taper Warp)').click());
    type(input('Taper bottom diameter'), '70');
    // 20 mm wide from the rim: narrowest at 20 mm down, Ø78.
    expect(preview()).toContain(`up to ${(Math.PI * 78).toFixed(2)} mm tall`);
    type(input('Taper artwork from top'), '80');
    // Now it reaches the Ø70 base, where 230 mm is more than one turn.
    expect(preview()).toContain(`Extends ${(230 - Math.PI * 70).toFixed(2)} mm past one turn`);
  });

  it('measures either end with the strip while the taper is on', () => {
    renderDialog(CHUCK);
    act(() => checkbox('Tapered part (Taper Warp)').click());
    act(() => button('Measure with a strip…').click());
    type(input('Measured wrap length'), String(Math.PI * 70.1));
    act(() => button('Use for the bottom').click());
    expect(input('Taper bottom diameter').value).toBe('70');
  });

  it('refuses a taper whose ends are further apart than it is long', () => {
    renderDialog(CHUCK);
    act(() => checkbox('Tapered part (Taper Warp)').click());
    type(input('Taper bottom diameter'), '70');
    type(input('Taper length'), '4');
    expect(button('Apply').disabled).toBe(true);
  });
});
