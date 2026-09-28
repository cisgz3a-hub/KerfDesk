import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene/scene-object';
import { ArrayDialog } from './ArrayDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ArrayDialog', () => {
  it('submits point rotation count and signed total angle', async () => {
    const onApply = vi.fn();
    await renderDialog({ onApply });
    const tabs = [...requiredHost().querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Grid', 'Point Rotation', 'Circular']);
    await act(async () => Simulate.click(button('Point Rotation')));
    expect(button('Point Rotation').getAttribute('aria-selected')).toBe('true');
    await setInput('Copies (includes original)', '5');
    await setInput('Total angle (deg)', '-180');
    const form = requiredHost().querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Array form missing');
    await act(async () => Simulate.submit(form));
    expect(onApply).toHaveBeenCalledWith({ kind: 'point-rotation', count: 5, totalAngleDeg: -180 });
  });

  it('submits the grid extras and converts the spacing when switching Space by', async () => {
    const onApply = vi.fn();
    await renderDialog({ onApply });
    expect(status()).toBe(
      '2 rows of 2: the original and 3 copies, 22 × 22 mm centre to centre, 42 × 42 mm overall.',
    );
    await setSelect('Space by', 'centres');
    expect(inputValue('Horizontal spacing (mm)')).toBe('22');
    expect(status()).toContain('22 × 22 mm centre to centre');
    await setInput('Horizontal spacing (mm)', '10');
    await setInput('Row shift (mm)', '5');
    await setInput('Column shift (mm)', '-1');
    await setSelect('Mirror alternate columns', 'vertical');
    await setSelect('Mirror alternate rows', 'both');
    await setCheck('Build right to left');
    await setCheck('Build bottom to top');
    expect(status()).toContain('10 × 22 mm centre to centre');
    await submit();
    expect(onApply).toHaveBeenCalledWith({
      kind: 'grid',
      rows: 2,
      columns: 2,
      spacingX: 10,
      spacingY: 22,
      spaceBy: 'centres',
      rowShift: 5,
      columnShift: -1,
      reverseColumns: true,
      reverseRows: true,
      mirrorColumns: 'vertical',
      mirrorRows: 'both',
    });
  });

  it('submits a partial circular arc with its status', async () => {
    const onApply = vi.fn();
    await renderDialog({ onApply });
    await act(async () => Simulate.click(button('Circular')));
    await setInput('Copies', '5');
    await setSelect('Spread copies', 'end');
    expect(inputValue('End angle (deg)')).toBe('360');
    await setInput('End angle (deg)', '90');
    expect(status()).toContain('The original and 4 copies, 22.5° apart from 0° to 90°');
    await submit();
    expect(onApply).toHaveBeenCalledWith({
      kind: 'circular',
      count: 5,
      centerX: 20,
      centerY: 30,
      radius: 25,
      startAngleDeg: 0,
      rotateCopies: false,
      arc: { kind: 'end', endAngleDeg: 90 },
    });
  });

  it('centres a circle on a selected object, which stays put', async () => {
    const onApply = vi.fn();
    await renderDialog({ onApply, selected: [square('hub', 45, 45), square('part', 45, 15)] });
    await act(async () => Simulate.click(button('Circular')));
    const options = [...select('Centre').querySelectorAll('option')].map((item) => item.text);
    expect(options).toEqual([
      'Selection centre',
      'Custom point',
      'Rectangle at 50, 20 mm',
      'Rectangle at 50, 50 mm',
    ]);
    await setSelect('Centre', 'object:hub');
    expect([inputValue('Center X (mm)'), inputValue('Center Y (mm)')]).toEqual(['50.00', '50.00']);
    expect([inputValue('Radius (mm)'), inputValue('Start angle (deg)')]).toEqual(['30', '270']);
    expect(status()).toContain('The centre object stays where it is.');
    expect(status()).not.toContain('The original moves');
    await submit();
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ centerX: 50, centerY: 50, radius: 30, centerObjectId: 'hub' }),
    );
    await setInput('Center X (mm)', '60');
    expect(select('Centre').value).toBe('point');
    expect(inputValue('Center Y (mm)')).toBe('50.00');
  });

  it('cancels without applying an array', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    await renderDialog({ onApply, onCancel });
    await act(async () => Simulate.click(button('Cancel')));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
});

async function renderDialog(props: {
  readonly onApply: React.ComponentProps<typeof ArrayDialog>['onApply'];
  readonly onCancel?: () => void;
  readonly selected?: ReadonlyArray<SceneObject>;
}): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <ArrayDialog
        selectionBounds={{ minX: 10, minY: 20, maxX: 30, maxY: 40 }}
        {...(props.selected === undefined ? {} : { selected: props.selected })}
        onCancel={props.onCancel ?? vi.fn()}
        onApply={props.onApply}
      />,
    ),
  );
}

function square(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    color: '#000000',
    paths: [],
  };
}

function labelled(labelText: string): HTMLLabelElement {
  const label = [...requiredHost().querySelectorAll('label')].find(
    (item) =>
      item.querySelector('span')?.textContent === labelText || item.textContent === labelText,
  );
  if (label === undefined) throw new Error(`${labelText} label missing`);
  return label;
}

function inputValue(labelText: string): string {
  return labelled(labelText).querySelector('input')?.value ?? '';
}

function select(labelText: string): HTMLSelectElement {
  const found = labelled(labelText).querySelector('select');
  if (found === null) throw new Error(`${labelText} select missing`);
  return found;
}

async function setSelect(labelText: string, value: string): Promise<void> {
  const element = select(labelText);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function setCheck(labelText: string): Promise<void> {
  const input = labelled(labelText).querySelector('input');
  if (input === null) throw new Error(`${labelText} checkbox missing`);
  await act(async () => input.click());
}

function status(): string {
  return requiredHost().querySelector('[role="status"]')?.textContent ?? '';
}

async function submit(): Promise<void> {
  const form = requiredHost().querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('Array form missing');
  await act(async () => Simulate.submit(form));
}

async function setInput(labelText: string, value: string): Promise<void> {
  const input = labelled(labelText).querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${labelText} input missing`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('input value setter missing');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const candidate = [...requiredHost().querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return candidate;
}

function requiredHost(): HTMLDivElement {
  if (host === null) throw new Error('Dialog host missing');
  return host;
}
