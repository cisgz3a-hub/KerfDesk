import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROTARY_SETUP, type RotarySetup } from '../../../core/devices';
import { DeviceSetupRotaryFields } from './DeviceSetupRotaryFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest: RotarySetup;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Harness(props: { readonly initial: RotarySetup }): JSX.Element {
  const [value, setValue] = useState(props.initial);
  latest = value;
  return <DeviceSetupRotaryFields value={value} onChange={setValue} />;
}

function control<T extends HTMLElement>(label: string): T {
  const found = host.querySelector<T>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`Missing control: ${label}`);
  return found;
}

describe('Machine Setup rotary roller scaling (ADR-373)', () => {
  it('adds a roller diameter only while roller scaling is on', () => {
    act(() => root.render(<Harness initial={DEFAULT_ROTARY_SETUP} />));
    expect(control<HTMLInputElement>('Motion per turn').disabled).toBe(true);
    expect(host.querySelector('[aria-label="Roller diameter"]')).toBeNull();

    act(() => control<HTMLInputElement>('Scale Y from the roller diameter').click());
    expect(latest.rollerDiameterMm).toBe(25);
    expect(control<HTMLInputElement>('Roller diameter').value).toBe('25');
    expect(control<HTMLInputElement>('Motion per turn').disabled).toBe(false);

    act(() => control<HTMLInputElement>('Scale Y from the roller diameter').click());
    expect(latest).toEqual(DEFAULT_ROTARY_SETUP);
    expect(latest).not.toHaveProperty('rollerDiameterMm');
  });

  it('shows no roller scaling for a chuck and drops the roller diameter', () => {
    act(() => root.render(<Harness initial={{ ...DEFAULT_ROTARY_SETUP, rollerDiameterMm: 30 }} />));
    const type = control<HTMLSelectElement>('Rotary type');
    act(() => {
      type.value = 'chuck';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest).toEqual({ ...DEFAULT_ROTARY_SETUP, type: 'chuck' });
    expect(host.querySelector('[aria-label="Scale Y from the roller diameter"]')).toBeNull();
    expect(control<HTMLInputElement>('Motion per turn').disabled).toBe(false);
    act(() => {
      type.value = 'roller';
      type.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.rollerDiameterMm).toBe(30);
  });
});
