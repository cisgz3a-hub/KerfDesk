// A Job Review Speed edit must change the speed that compiles, including for
// artwork whose own settings own that field (ADR-317). Traced artwork carries
// an override from import, and an Artwork-panel speed edit on it lands there,
// so the row used to show and change only the operation base while the trace
// kept its own speed (controller audit 2026-09-23, speed-2). The oracle is
// compileJob, not the table's own state.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { compileJob } from '../../../core/job/compile-job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JobReviewLayersTable } from './JobReviewLayersTable';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const OP_ID = 'fill-op';
const SPEED_CELL = 'input[aria-label^="Speed mm/min for"]';

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function square(
  id: string,
  minX: number,
  operationOverride?: ObjectOperationOverride,
): SceneObject {
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    traceMode: 'filled-contours',
    bounds: { minX, minY: 10, maxX: minX + 20, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [OP_ID],
    ...(operationOverride === undefined ? {} : { operationOverride }),
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: minX, y: 10 },
              { x: minX + 20, y: 10 },
              { x: minX + 20, y: 30 },
              { x: minX, y: 30 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function seed(objects: ReadonlyArray<SceneObject>): void {
  const layer = {
    ...createLayer({ id: OP_ID, color: '#000000' }),
    mode: 'fill' as const,
    speed: 1000,
  };
  useStore.setState({
    project: {
      ...createProject(),
      device: DEFAULT_DEVICE_PROFILE,
      scene: { ...EMPTY_SCENE, layers: [layer], objects },
    },
    undoStack: [],
    redoStack: [],
  });
}

function compiledSpeeds(): number[] {
  const { scene, device } = useStore.getState().project;
  return compileJob(scene, device).groups.map((group) => ('speed' in group ? group.speed : NaN));
}

async function mountReview(): Promise<{
  readonly cell: HTMLInputElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<JobReviewLayersTable machineKind="laser" effectiveOperations={[]} />),
  );
  const cell = host.querySelector<HTMLInputElement>(SPEED_CELL);
  if (cell === null) throw new Error('Job Review speed cell missing');
  return { cell, unmount: async () => act(async () => root.unmount()) };
}

async function typeAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

const TRACE_OVERRIDE: ObjectOperationOverride = {
  mode: 'fill',
  fillStyle: 'scanline',
  speed: 2500,
};

describe('Job Review speed on artwork that owns its speed', () => {
  it('shows the speed the artwork actually runs at', async () => {
    seed([square('trace', 10, TRACE_OVERRIDE)]);
    expect(compiledSpeeds()).toEqual([2500]);
    const review = await mountReview();
    try {
      expect(review.cell.value).toBe('2500');
    } finally {
      await review.unmount();
    }
  });

  it('changes the compiled speed of the owning artwork', async () => {
    seed([square('trace', 10, TRACE_OVERRIDE)]);
    const review = await mountReview();
    try {
      await typeAndBlur(review.cell, '4000');
    } finally {
      await review.unmount();
    }
    expect(compiledSpeeds()).toEqual([4000]);
    // The owner keeps owning only what it owned: its fill style survives.
    const trace = useStore.getState().project.scene.objects[0];
    expect(trace?.operationOverride?.byOperation?.[OP_ID]?.fillStyle).toBe('scanline');
  });

  it('moves every artwork on the operation, owners and followers alike', async () => {
    seed([square('trace', 10, TRACE_OVERRIDE), square('plain', 50)]);
    expect([...compiledSpeeds()].sort((a, b) => a - b)).toEqual([1000, 2500]);
    const review = await mountReview();
    try {
      await typeAndBlur(review.cell, '3000');
    } finally {
      await review.unmount();
    }
    // Equal settings compile into one group; every burn runs at the new speed.
    expect(new Set(compiledSpeeds())).toEqual(new Set([3000]));
  });
});
