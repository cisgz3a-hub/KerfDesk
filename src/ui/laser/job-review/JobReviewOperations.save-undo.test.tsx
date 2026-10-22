// Audit 2026-10-21 06-P2-5. A Job Review Save on an operation where an artwork
// owns the edited field wrote the operation base and the artwork's own value as
// two undo steps. One Undo then left a job that was neither before nor after
// the Save: the owner back at 80 %, its sibling still at 40 %, and the card
// reading 40 %. One Save is now one undo step. The oracle is the emitted program.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type SceneObject,
} from '../../../core/scene';
import { emittedBurn } from '../../layers/__fixtures__/operation-gcode';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JobReviewOperations } from './JobReviewOperations';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const OP = 'cut';
const POWER_FIELD = 'input[aria-label^="Power % for"]';

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

function square(id: string, minX: number, override?: ObjectOperationOverride): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX, minY: 10, maxX: minX + 10, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [OP],
    ...(override === undefined ? {} : { operationOverride: override }),
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: minX, y: 10 },
              { x: minX + 10, y: 10 },
              { x: minX + 10, y: 20 },
              { x: minX, y: 20 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function seed(): void {
  const layer = { ...createLayer({ id: OP, name: 'Cut', color: '#000000' }), power: 80 };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        layers: [layer],
        objects: [square('a', 10, { byOperation: { [OP]: { power: 80 } } }), square('b', 40)],
      },
    },
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  if (found === undefined) throw new Error(`${text} button missing`);
  return found;
}

function powers(): Record<string, ReadonlyArray<number>> {
  const { project } = useStore.getState();
  return {
    a: emittedBurn(project, 'a').powers,
    b: emittedBurn(project, 'b').powers,
  };
}

describe('Job Review Save history', () => {
  it('is one undo step when an artwork owns the edited field', async () => {
    seed();
    expect(powers()).toEqual({ a: [800], b: [800] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(<JobReviewOperations machineKind="laser" effectiveOperations={[]} />),
      );
      await act(async () => button(host, 'Edit').click());
      const power = host.querySelector<HTMLInputElement>(POWER_FIELD);
      if (power === null) throw new Error('Job Review power field missing');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          power,
          '40',
        );
        power.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => button(host, 'Save').click());

      expect(powers()).toEqual({ a: [400], b: [400] });
      expect(useStore.getState().undoStack).toHaveLength(1);

      await act(async () => useStore.getState().undo());
      expect(powers()).toEqual({ a: [800], b: [800] });
      expect(useStore.getState().project.scene.layers[0]?.power).toBe(80);
      expect(host.querySelector<HTMLInputElement>(POWER_FIELD)).toBeNull();
      expect(host.textContent).toContain('80');

      await act(async () => useStore.getState().redo());
      expect(powers()).toEqual({ a: [400], b: [400] });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
