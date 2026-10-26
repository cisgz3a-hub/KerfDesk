// Audit 2026-10-21 06-P2-2. Cut Settings opened for ONE artwork that already
// has its own settings wrote the whole form into that artwork's override, so
// every field became the artwork's own and later operation edits skipped it
// while the inspector said "Edits apply to all of them". ADR-317 §1: omitted
// fields inherit the operation base, so Apply writes only what was edited, as
// the multi-artwork path already did. The oracle is the emitted program.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { edit, field, openAdvanced } from './__fixtures__/selected-operation-inspector';
import { emittedBurn } from './__fixtures__/operation-gcode';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const OP = 'op';

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

function seed(override: ObjectOperationOverride): void {
  const layer = { ...createLayer({ id: OP, color: '#000000' }), power: 80, speed: 1000 };
  useStore.setState({
    project: {
      ...createProject(),
      scene: { layers: [layer], objects: [square('a', 10, override), square('b', 40)] },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function Inspector(props: { readonly ids: ReadonlyArray<string> }): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  return (
    <SelectedOperationInspector
      objects={objects.filter((object) => props.ids.includes(object.id))}
      selectionActive
    />
  );
}

async function inspect(ids: ReadonlyArray<string>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector ids={ids} />));
  return { host, unmount: () => act(async () => root.unmount()) };
}

async function applyPassesInCutSettings(host: HTMLElement, passes: string): Promise<void> {
  await openAdvanced(host);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Cut settings passes"]');
  if (input === null || input.form === null) throw new Error('Cut Settings passes missing');
  await act(async () => {
    // The prototype setter, as a browser does: React's tracker ignores a
    // value set on the element itself and would see no edit.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, passes);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(input.form.checkValidity()).toBe(true);
  const form = input.form;
  await act(async () => form.requestSubmit());
}

function ownSettings(id: string): unknown {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  return object?.operationOverride?.byOperation?.[OP];
}

describe('Cut Settings for one artwork with its own settings', () => {
  it.each([
    ['an earlier power edit', { power: 30 }],
    ['a traced fill import', { mode: 'line', fillStyle: 'scanline', power: 30 }],
  ] as const)(
    'writes only the edited field over %s, so the artwork keeps following the operation',
    async (_label, override) => {
      seed(override);
      const one = await inspect(['a']);
      try {
        await applyPassesInCutSettings(one.host, '2');
      } finally {
        await one.unmount();
      }
      expect(ownSettings('a')).toEqual({ ...override, passes: 2 });
      expect(useStore.getState().undoStack).toHaveLength(1);

      // The sibling follows the operation; its Speed edit is an operation edit.
      const sibling = await inspect(['b']);
      try {
        expect(sibling.host.textContent).toContain('Edits apply to all of them');
        await edit(field(sibling.host, 'Speed'), '600');
      } finally {
        await sibling.unmount();
      }
      const { project } = useStore.getState();
      expect(project.scene.layers[0]?.speed).toBe(600);
      const a = emittedBurn(project, 'a');
      expect(a.feeds).toEqual([600]);
      expect(a.powers).toEqual([300]);
      expect(emittedBurn(project, 'b')).toMatchObject({ feeds: [600], powers: [800] });
      // Two passes of four sides on `a`, one pass on `b`.
      expect(a.cutMoves).toBe(2 * emittedBurn(project, 'b').cutMoves);
    },
  );
});
