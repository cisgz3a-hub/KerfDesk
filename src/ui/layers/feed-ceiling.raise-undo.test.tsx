// Rolling audit 2026-10-21 (06-P2-5 twin, ADR-361 Amendment 1). Raise Output
// max feed changed the machine with `updateDeviceProfile` and then re-applied
// the speed with a second store action: two undo steps. One Undo left the
// ceiling raised with the old speed, or the reverse. The Raise is now one undo
// step. The oracle is the emitted program's F word on the cut moves.

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { emittedBurn } from './__fixtures__/operation-gcode';
import { edit, field, mount } from './__fixtures__/selected-operation-inspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const OP = 'cut';
const RAISE = 'Raise Output max feed to 15,000 mm/min';

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function square(override?: ObjectOperationOverride): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'a',
    source: 'a.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [OP],
    ...(override === undefined ? {} : { operationOverride: override }),
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
              { x: 10, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function seed(override?: ObjectOperationOverride): void {
  const layer = { ...createLayer({ id: OP, name: 'Cut', color: '#000000' }), speed: 3000 };
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, maxFeed: 10000 },
      scene: { ...EMPTY_SCENE, layers: [layer], objects: [square(override)] },
    },
    selectedObjectId: 'a',
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

type Snapshot = {
  readonly maxFeed: number;
  readonly operationSpeed: number | undefined;
  readonly artworkSpeed: number;
  readonly feeds: ReadonlyArray<number>;
  readonly undoSteps: number;
};

function snapshot(): Snapshot {
  const { project, undoStack } = useStore.getState();
  const layer = project.scene.layers[0];
  const object = project.scene.objects[0];
  if (layer === undefined || object === undefined) throw new Error('fixture missing');
  return {
    maxFeed: project.device.maxFeed,
    operationSpeed: layer.speed,
    artworkSpeed: effectiveOperationForObject(layer, object).speed,
    feeds: emittedBurn(project, 'a').feeds,
    undoSteps: undoStack.length,
  };
}

function raiseButton(host: HTMLElement): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === RAISE);
  if (found === undefined) throw new Error('raise button missing');
  return found;
}

/** Types 15000 against a 10000 ceiling, then clicks Raise: returns the state
 * just before the click and just after it. */
async function typeAndRaise(): Promise<{ readonly capped: Snapshot; readonly raised: Snapshot }> {
  const mounted = await mount();
  try {
    await edit(field(mounted.host, 'Speed'), '15000');
    const capped = snapshot();
    await act(async () => raiseButton(mounted.host).click());
    return { capped, raised: snapshot() };
  } finally {
    await mounted.unmount();
  }
}

describe('Raise Output max feed history', () => {
  it('is one undo step when the speed belongs to the operation', async () => {
    seed();
    const { capped, raised } = await typeAndRaise();

    expect(capped).toEqual({
      maxFeed: 10000,
      operationSpeed: 10000,
      artworkSpeed: 10000,
      feeds: [10000],
      undoSteps: 1,
    });
    expect(raised).toEqual({
      maxFeed: 15000,
      operationSpeed: 15000,
      artworkSpeed: 15000,
      feeds: [15000],
      undoSteps: 2,
    });

    // One Undo puts back both the old ceiling and the old speed.
    act(() => useStore.getState().undo());
    expect(snapshot()).toEqual(capped);

    act(() => useStore.getState().redo());
    expect(snapshot()).toEqual(raised);
  });

  it('is one undo step when the artwork owns its speed', async () => {
    seed({ byOperation: { [OP]: { speed: 8000 } } });
    const { capped, raised } = await typeAndRaise();

    // The edit lands in the artwork's own settings; the operation keeps 3000.
    expect(capped).toEqual({
      maxFeed: 10000,
      operationSpeed: 3000,
      artworkSpeed: 10000,
      feeds: [10000],
      undoSteps: 1,
    });
    expect(raised).toEqual({
      maxFeed: 15000,
      operationSpeed: 3000,
      artworkSpeed: 15000,
      feeds: [15000],
      undoSteps: 2,
    });

    act(() => useStore.getState().undo());
    expect(snapshot()).toEqual(capped);

    act(() => useStore.getState().redo());
    expect(snapshot()).toEqual(raised);
  });
});
