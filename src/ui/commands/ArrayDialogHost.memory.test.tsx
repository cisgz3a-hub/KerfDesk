// The Array dialog reopens with the settings last applied in the session,
// less a centre object, which falls back to the selection centre.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { useStore } from '../state';
import { ArrayDialogHost, resetArrayDialogMemory } from './ArrayDialogHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const initial = useStore.getState();

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

beforeEach(() => {
  resetArrayDialogMemory();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square('hub', 45, 45), square('part', 45, 15)],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'hub',
    additionalSelectedIds: new Set(['part']),
  });
});

afterEach(async () => {
  await unmount();
  useStore.setState(initial, true);
});

describe('Array dialog session memory', () => {
  it('reopens with the settings last applied, but centred on the selection', async () => {
    const close = await mount();
    await act(async () => Simulate.click(button('Circular')));
    await setSelect('Centre', 'object:hub');
    await setInput('Copies', '5');
    await setSelect('Spread copies', 'end');
    await setInput('End angle (deg)', '90');
    await act(async () => checkbox('Rotate copies around the circle').click());
    await submit();
    expect(close).toHaveBeenCalledOnce();
    expect(useStore.getState().project.scene.objects).toHaveLength(6);

    await unmount();
    await mount();
    expect(button('Circular').getAttribute('aria-selected')).toBe('true');
    expect(inputValue('Copies')).toBe('5');
    expect(select('Spread copies').value).toBe('end');
    expect(inputValue('End angle (deg)')).toBe('90');
    expect([inputValue('Radius (mm)'), inputValue('Start angle (deg)')]).toEqual(['30', '270']);
    expect(checkbox('Rotate copies around the circle').checked).toBe(true);
    expect(select('Centre').value).toBe('selection');
  });

  it('forgets settings that were cancelled', async () => {
    await mount();
    await setInput('Rows', '7');
    await act(async () => Simulate.click(button('Cancel')));
    await unmount();
    await mount();
    expect(button('Grid').getAttribute('aria-selected')).toBe('true');
    expect(inputValue('Rows')).toBe('2');
  });
});

async function mount(): Promise<ReturnType<typeof vi.fn>> {
  const close = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ArrayDialogHost onClose={close} />));
  return close;
}

async function unmount(): Promise<void> {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

function requiredHost(): HTMLDivElement {
  if (host === null) throw new Error('Dialog host missing');
  return host;
}

function button(text: string): HTMLButtonElement {
  const found = [...requiredHost().querySelectorAll('button')].find(
    (item) => item.textContent === text,
  );
  if (found === undefined) throw new Error(`Missing button ${text}`);
  return found;
}

function labelled(text: string): HTMLLabelElement {
  const label = [...requiredHost().querySelectorAll('label')].find(
    (item) => item.querySelector('span')?.textContent === text || item.textContent === text,
  );
  if (label === undefined) throw new Error(`Missing ${text}`);
  return label;
}

function inputValue(text: string): string {
  return labelled(text).querySelector('input')?.value ?? '';
}

function checkbox(text: string): HTMLInputElement {
  const input = labelled(text).querySelector('input');
  if (input === null) throw new Error(`Missing ${text} checkbox`);
  return input;
}

function select(text: string): HTMLSelectElement {
  const found = labelled(text).querySelector('select');
  if (found === null) throw new Error(`Missing ${text} select`);
  return found;
}

async function setSelect(text: string, value: string): Promise<void> {
  const element = select(text);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function setInput(text: string, value: string): Promise<void> {
  const input = labelled(text).querySelector('input');
  if (input === null) throw new Error(`Missing ${text} input`);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

async function submit(): Promise<void> {
  const form = requiredHost().querySelector('form');
  if (form === null) throw new Error('Missing form');
  await act(async () => Simulate.submit(form));
}
