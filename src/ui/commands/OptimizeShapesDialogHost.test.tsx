import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Vec2 } from '../../core/scene/scene-object';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  openOptimizeShapesDialog,
  useOptimizeShapesDialogStore,
} from './optimize-shapes-dialog-store';
import {
  OptimizeShapesDialogHost,
  resetOptimizeShapesDialogMemory,
} from './OptimizeShapesDialogHost';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  resetOptimizeShapesDialogMemory();
  useOptimizeShapesDialogStore.setState({ open: false });
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// A traced-looking circle: 400 points with 0.06 mm of jitter.
function tracedCircle(id: string, locked = false): ImportedSvg {
  let state = 7;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
  const points: Vec2[] = Array.from({ length: 400 }, (_, k) => {
    const angle = (2 * Math.PI * k) / 400;
    const r = 10 + 0.06 * random();
    return { x: 20 + r * Math.cos(angle), y: 20 + r * Math.sin(angle) };
  });
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
    ...(locked ? { locked: true } : {}),
  };
}

async function open(objects: ReadonlyArray<ImportedSvg>): Promise<void> {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [createLayer({ id: 'cut', color: '#000000' })], groups: [] },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
  });
  await act(async () => root.render(<OptimizeShapesDialogHost />));
  await act(async () => openOptimizeShapesDialog());
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function status(): string {
  return document.querySelector('[role="status"]')?.textContent ?? '';
}

// The status line is worked out a slice at a time after a short pause.
async function settled(): Promise<string> {
  for (let tries = 0; tries < 100 && status().startsWith('Working it out'); tries += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  }
  return status();
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}

function control(label: string): HTMLInputElement | HTMLSelectElement {
  const row = Array.from(document.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.startsWith(label),
  );
  const found = row?.querySelector<HTMLInputElement | HTMLSelectElement>(
    'input[type="number"], input[type="checkbox"], select',
  );
  if (found === null || found === undefined) throw new Error(`${label} missing`);
  return found;
}

describe('Optimize Shapes dialog', () => {
  it('opens with its defaults, gives every control a title, and says what will happen', async () => {
    await open([tracedCircle('a')]);

    expect(dialog()).not.toBeNull();
    expect((control('Smooth') as HTMLInputElement).checked).toBe(true);
    expect(control('Smoothing (mm)').value).toBe('0.25');
    expect(control('Corner angle (°)').value).toBe('30');
    expect(control('Tolerance (mm)').value).toBe('0.05');
    expect(control('Fit with').value).toBe('lines-arcs-curves');
    for (const element of dialog()?.querySelectorAll('input, select') ?? []) {
      expect(element.getAttribute('title')).toBeTruthy();
    }
    expect(await settled()).toMatch(
      /^400 points become \d+ segments; nothing moves more than 0\.\d+ mm\.$/,
    );
  });

  it('applies what the status line promised as one undo step and closes', async () => {
    await open([tracedCircle('a'), tracedCircle('l', true)]);
    const promised = await settled();
    expect(promised).toMatch(/ 1 locked object is left as it is\.$/);

    await act(async () => button('Optimize').click());
    await settled();

    expect(dialog()).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(1);
    const segments = promised.match(/become (\d+) segments/)?.[1];
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      `400 points became ${segments} segments`,
    );
  });

  it('asks for Smooth or Fit when both are off', async () => {
    await open([tracedCircle('a')]);

    for (const label of ['Smooth', 'Fit to lines, arcs and curves']) {
      const box = control(label) as HTMLInputElement;
      await act(async () => {
        box.checked = false;
        Simulate.change(box);
      });
    }

    expect(status()).toBe('Turn on Smooth or Fit to change the outlines.');
    expect(button('Optimize').disabled).toBe(true);
  });

  it('says why it cannot open on locked artwork alone', async () => {
    await open([tracedCircle('l', true)]);

    expect(dialog()).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
  });
});
