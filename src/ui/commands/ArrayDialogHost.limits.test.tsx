// The Array dialog and the project's object limit (ADR-307 amendment 1): the
// status line says what fits and Create array stays off until the request fits,
// so the store never has to refuse it. Whatever is typed costs the same.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { useStore } from '../state';
import { ArrayDialogHost, resetArrayDialogMemory } from './ArrayDialogHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LIMIT = PROJECT_SCENE_LIMITS.objects;
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

// The selection plus enough filler that `room` more copies of one square fit.
function load(selected: ReadonlyArray<SceneObject>, room: number): void {
  const filler = Array.from({ length: LIMIT - room - selected.length }, (_, index) =>
    square(`filler-${index}`, 300, 0),
  );
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [...selected, ...filler],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0]?.id ?? null,
    additionalSelectedIds: new Set(selected.slice(1).map((object) => object.id)),
    undoStack: [],
  });
}

function roomMessage(room: number, ask: string): string {
  return `This project has room for at most ${room} more copies of this selection (project limit ${LIMIT} objects). ${ask}`;
}

beforeEach(() => {
  resetArrayDialogMemory();
});

afterEach(async () => {
  await unmount();
  useStore.setState(initial, true);
});

describe('Array dialog and the project limit', () => {
  it('explains a grid the project cannot hold and keeps Create array off until it fits', async () => {
    load([square('part', 0, 0)], 18);
    const close = await mount();
    expect(status()).toContain('2 rows of 2');
    expect(button('Create array').disabled).toBe(false);

    await setInput('Rows', '1');
    await setInput('Columns', '20');
    expect(status()).toBe(roomMessage(18, 'Use fewer rows or columns.'));
    expect(button('Create array').disabled).toBe(true);
    const before = useStore.getState().project;
    await submit();
    expect(useStore.getState().project).toBe(before);
    expect(close).not.toHaveBeenCalled();

    await setInput('Columns', '19');
    expect(status()).toContain('1 row of 19: the original and 18 copies');
    expect(button('Create array').disabled).toBe(false);
    await submit();
    expect(useStore.getState().project.scene.objects).toHaveLength(LIMIT);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('holds the circular and point rotation modes to the same room', async () => {
    load([square('part', 0, 0)], 18);
    await mount();

    await act(async () => Simulate.click(button('Circular')));
    await setInput('Copies', '20');
    expect(status()).toBe(roomMessage(18, 'Use fewer copies.'));
    expect(button('Create array').disabled).toBe(true);
    await setInput('Copies', '19');
    expect(button('Create array').disabled).toBe(false);

    await act(async () => Simulate.click(button('Point Rotation')));
    await setInput('Copies (includes original)', '20');
    expect(status()).toBe(roomMessage(18, 'Use fewer copies.'));
    expect(button('Create array').disabled).toBe(true);
    await setInput('Copies (includes original)', '19');
    expect(button('Create array').disabled).toBe(false);
  });

  it('does not count the object a circle is centred on, which is not copied', async () => {
    load([square('hub', 45, 45), square('part', 45, 15)], 10);
    await mount();

    await act(async () => Simulate.click(button('Circular')));
    await setSelect('Centre', 'object:hub');
    await setInput('Copies', '12');
    expect(status()).toBe(roomMessage(10, 'Use fewer copies.'));
    await setInput('Copies', '11');
    expect(button('Create array').disabled).toBe(false);
  });

  it.each([
    ['rows and columns of a million', 'Rows', '1e6', 'Columns', '1e6'],
    ['rows past the largest number', 'Rows', '1e300', 'Columns', '1e300'],
  ])('reads %s as too many, without laying anything out', async (_name, rows, a, columns, b) => {
    load([square('part', 0, 0)], LIMIT - 1);
    await mount();

    await setInput(rows, a);
    await setInput(columns, b);

    expect(status()).toBe(roomMessage(LIMIT - 1, 'Use fewer rows or columns.'));
    expect(button('Create array').disabled).toBe(true);
  });

  it('says so when the project has no room for another copy', async () => {
    load([square('part', 0, 0)], 0);
    await mount();

    expect(status()).toBe(
      `This project has no room for another copy of this selection (project limit ${LIMIT} objects). Delete some objects first.`,
    );
    expect(button('Create array').disabled).toBe(true);
    await setInput('Rows', '1');
    await setInput('Columns', '1');
    expect(status()).toContain('Only the original');
    expect(button('Create array').disabled).toBe(false);
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

function status(): string {
  return requiredHost().querySelector('[role="status"]')?.textContent ?? '';
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
