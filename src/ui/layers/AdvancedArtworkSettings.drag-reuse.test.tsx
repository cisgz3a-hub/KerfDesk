// S2-P3-3: a drag stores every selected object again per step with only its
// transform changed. The power rows name nothing a transform changes, so they
// are kept rather than rebuilt per object per step. Counted, not timed.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer, type SceneObject } from '../../core/scene';
import { svgObj } from '../state/test-helpers';
import { AdvancedArtworkSettings } from './AdvancedArtworkSettings';
import type * as Runs from './artwork-output-runs';

const runs = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./artwork-output-runs', async (importOriginal) => {
  const actual = await importOriginal<typeof Runs>();
  return {
    ...actual,
    artworkOutputRuns: (...args: Parameters<typeof actual.artworkOutputRuns>) => {
      runs.calls += 1;
      return actual.artworkOutputRuns(...args);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

const COUNT = 200;
const layers: ReadonlyArray<Layer> = [createLayer({ id: 'cut', color: '#000000' })];
const placed: ReadonlyArray<SceneObject> = Array.from({ length: COUNT }, (_, index) => ({
  ...svgObj(`o${index}`, ['#000000']),
  operationIds: ['cut'],
}));

function moved(objects: ReadonlyArray<SceneObject>, dx: number): ReadonlyArray<SceneObject> {
  return objects.map((object) => ({
    ...object,
    transform: { ...object.transform, x: object.transform.x + dx },
  }));
}

async function mount(objects: ReadonlyArray<SceneObject>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (next: ReadonlyArray<SceneObject>) =>
    act(async () =>
      root.render(<AdvancedArtworkSettings objects={next} layers={layers} selectionActive />),
    );
  await render(objects);
  const rows = () =>
    host.querySelector('[aria-label="Resulting artwork power"]')?.textContent ?? '';
  return { render, rows, unmount: () => act(async () => root.unmount()) };
}

describe('AdvancedArtworkSettings during a drag (S2-P3-3)', () => {
  it('keeps the power rows while the selection only moves', async () => {
    runs.calls = 0;
    const view = await mount(placed);
    const first = view.rows();
    const afterMount = runs.calls;
    expect(afterMount).toBeGreaterThanOrEqual(COUNT);
    for (let step = 1; step <= 20; step += 1) await view.render(moved(placed, step));
    // Twenty drag steps rebuild no row; main rebuilt 200 per step (4,000).
    expect(runs.calls).toBe(afterMount);
    expect(view.rows()).toBe(first);
    await view.unmount();
  });

  it('rebuilds the rows when a member changes what it burns', async () => {
    runs.calls = 0;
    const view = await mount(placed);
    const before = runs.calls;
    const scaled = moved(placed, 3).map((object, index) =>
      index === 7 ? { ...object, powerScale: 50 } : object,
    );
    await view.render(scaled);
    // Rebuilt (twice: the field then reads the selection as mixed, which
    // changes the draft scale the rows use).
    expect(runs.calls).toBeGreaterThanOrEqual(before + COUNT);
    expect(view.rows()).toContain('50%');
    await view.unmount();
  });
});
