import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  toMachineCoords,
  toSceneCoords,
  type Origin,
} from '../../core/devices';
import { HomingCornerPicker, OriginCornerPicker } from './DeviceProfileFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINS: readonly Origin[] = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];
const ORIGIN_TITLE =
  "Sets the canvas-to-machine coordinate orientation and jog directions. Match the controller's coordinate layout. This does not set work zero or change homing settings.";
const HOME_TITLE =
  "Record where this machine homes. The controller's firmware determines the actual homing direction; changing this record does not change firmware.";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode): void {
  act(() => root.render(node));
}
function group(name: string): HTMLElement {
  const node = host.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${name}"]`);
  if (!node) throw new Error(`Missing radio group: ${name}`);
  return node;
}
function radios(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}
function radio(name: string): HTMLButtonElement {
  const node = radios().find((item) => item.getAttribute('aria-label') === name);
  if (!node) throw new Error(`Missing radio: ${name}`);
  return node;
}
function checkedName(): string | null {
  return (
    radios()
      .find((item) => item.getAttribute('aria-checked') === 'true')
      ?.getAttribute('aria-label') ?? null
  );
}
function press(target: HTMLElement, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function StatefulOrigin(props: {
  readonly initial: Origin;
  readonly onChange: (next: Origin) => void;
}): JSX.Element {
  const [value, setValue] = useState(props.initial);
  return (
    <OriginCornerPicker
      value={value}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
}

// Physical direction of each machine axis, read from the real canvas-to-machine
// transform rather than from the jog table the picker draws with. Canvas +X is
// the operator's right; canvas -Y is the back of the bed (away from the operator).
function machineAxisDirections(origin: Origin): {
  readonly x: 'right' | 'left';
  readonly y: 'away' | 'toward';
} {
  const device = { ...DEFAULT_DEVICE_PROFILE, origin };
  const here = toMachineCoords({ x: 100, y: 100 }, device);
  const right = toMachineCoords({ x: 101, y: 100 }, device);
  const back = toMachineCoords({ x: 100, y: 99 }, device);
  return { x: right.x > here.x ? 'right' : 'left', y: back.y > here.y ? 'away' : 'toward' };
}

// Where machine (0, 0) sits on the bed, from the inverse transform.
function machineZeroPlace(origin: Origin): { readonly x: number; readonly y: number } {
  const device = { ...DEFAULT_DEVICE_PROFILE, origin };
  const zero = toSceneCoords({ x: 0, y: 0 }, device);
  return {
    x: Math.sign(zero.x - device.bedWidth / 2),
    y: Math.sign(zero.y - device.bedHeight / 2),
  };
}

function arrowLine(axis: 'x' | 'y'): { x1: number; y1: number; x2: number; y2: number } {
  const line = host.querySelector(`[data-axis="${axis}"] line`);
  if (!line) throw new Error(`Missing ${axis} arrow`);
  const read = (name: string): number => Number(line.getAttribute(name));
  return { x1: read('x1'), y1: read('y1'), x2: read('x2'), y2: read('y2') };
}

describe('OriginCornerPicker', () => {
  it('is one radio group with a named target per corner and the existing title', () => {
    render(<OriginCornerPicker value="front-left" onChange={() => undefined} />);
    const picker = group('Machine origin corner');
    expect(picker.getAttribute('title')).toBe(ORIGIN_TITLE);
    expect(radios().map((item) => item.getAttribute('aria-label'))).toEqual([
      'Rear left',
      'Rear right',
      'Center',
      'Front left',
      'Front right',
    ]);
    expect(checkedName()).toBe('Front left');
    // Roving tab stop: only the chosen corner is in the tab order.
    expect(radios().map((item) => item.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
    expect(host.querySelector('svg')?.textContent).toContain('Front (operator side)');
  });

  it('chooses a corner on click and stays quiet when the chosen one is clicked', () => {
    const onChange = vi.fn();
    render(<OriginCornerPicker value="front-left" onChange={onChange} />);
    act(() => radio('Rear right').click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('rear-right');
    act(() => radio('Front left').click());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('moves the choice and focus with the arrow keys, Home and End', () => {
    const onChange = vi.fn();
    render(<StatefulOrigin initial="front-left" onChange={onChange} />);
    const steps: ReadonlyArray<readonly [string, string, Origin]> = [
      ['ArrowRight', 'Front right', 'front-right'],
      ['ArrowDown', 'Rear left', 'rear-left'],
      ['ArrowLeft', 'Front right', 'front-right'],
      ['ArrowUp', 'Front left', 'front-left'],
      ['ArrowUp', 'Center', 'center'],
      ['Home', 'Rear left', 'rear-left'],
      ['End', 'Front right', 'front-right'],
    ];
    radio('Front left').focus();
    for (const [key, name, value] of steps) {
      press(document.activeElement as HTMLElement, key);
      expect(checkedName()).toBe(name);
      expect(document.activeElement).toBe(radio(name));
      expect(radio(name).tabIndex).toBe(0);
      expect(onChange).toHaveBeenLastCalledWith(value);
    }
    expect(onChange).toHaveBeenCalledTimes(steps.length);
  });

  it.each(ORIGINS)('draws the +X/+Y arrows %s really produces', (origin) => {
    render(<OriginCornerPicker value={origin} onChange={() => undefined} />);
    const expected = machineAxisDirections(origin);
    const x = arrowLine('x');
    expect(x.y1).toBe(x.y2);
    expect(x.x2 > x.x1 ? 'right' : 'left').toBe(expected.x);
    const y = arrowLine('y');
    expect(y.x1).toBe(y.x2);
    // The diagram's front edge is at the bottom, so "away from the operator" is up.
    expect(y.y2 < y.y1 ? 'away' : 'toward').toBe(expected.y);
    expect(host.querySelector('.lf-bed-picker__caption')?.textContent).toContain(
      `+X ${expected.x === 'right' ? 'to your right' : 'to your left'}, +Y ${expected.y === 'away' ? 'away from you' : 'toward you'}`,
    );
  });

  it.each(ORIGINS)('marks the %s dot where machine zero lands on the bed', (origin) => {
    render(<OriginCornerPicker value={origin} onChange={() => undefined} />);
    const centre = radio('Center');
    const chosen = radios().find((item) => item.getAttribute('aria-checked') === 'true');
    if (!chosen) throw new Error('Nothing chosen');
    const place = {
      x: Math.sign(parseFloat(chosen.style.left) - parseFloat(centre.style.left)),
      y: Math.sign(parseFloat(chosen.style.top) - parseFloat(centre.style.top)),
    };
    expect(place).toEqual(machineZeroPlace(origin));
    expect(chosen.querySelector('.lf-bed-picker__dot')).not.toBeNull();
  });
});

describe('HomingCornerPicker', () => {
  it('shows its own home marker without axis arrows and keeps the existing title', () => {
    render(<HomingCornerPicker value="rear-right" onChange={() => undefined} />);
    const picker = group('Recorded homing corner');
    expect(picker.getAttribute('title')).toBe(HOME_TITLE);
    expect(checkedName()).toBe('Rear right');
    expect(radio('Rear right').querySelector('.lf-bed-picker__home')).not.toBeNull();
    expect(host.querySelectorAll('.lf-bed-picker__home')).toHaveLength(1);
    expect(host.querySelector('[data-axis]')).toBeNull();
  });

  it('records a corner on click or arrow key, and the "Recorded home" text changes nothing', () => {
    const onChange = vi.fn();
    render(<HomingCornerPicker value="front-left" onChange={onChange} />);
    const text = [...host.querySelectorAll('span')].find(
      (item) => item.textContent === 'Recorded home',
    );
    act(() => text?.click());
    expect(onChange).not.toHaveBeenCalled();
    act(() => radio('Rear left').click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('rear-left');
    press(radio('Front left'), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('front-right');
  });
});
