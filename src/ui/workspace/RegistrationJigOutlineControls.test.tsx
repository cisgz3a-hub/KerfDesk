import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, isRegistrationBox, type Scene } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import type { RegistrationJigSetSpec } from '../state/registration-jig-set-actions';
import { useStore } from '../state/store';
import { RegistrationJigOutlineControls } from './RegistrationJigOutlineControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
let host: HTMLDivElement;
let root: Root;
let leftover: ReadonlySet<string> = new Set();
beforeEach(() => {
  useStore.setState({ project: createProject(), undoStack: [] });
  leftover = new Set();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(initial, true);
});

function TestControls(): JSX.Element {
  const scene = useStore((state) => state.project.scene);
  return (
    <RegistrationJigOutlineControls
      key={JSON.stringify(scene.objects.filter(isRegistrationBox))}
      scene={scene}
      onReplace={(spec, removed) => {
        useStore.getState().replaceRegistrationJigSet(spec);
        leftover = removed;
      }}
      onRemove={useStore.getState().removeRegistrationBox}
    />
  );
}

function field(label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (input === null) throw new Error(`Missing ${label}`);
  return input;
}
async function type(label: string, value: string): Promise<void> {
  const input = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function leave(label: string): Promise<void> {
  await act(async () => {
    field(label).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  });
}
async function press(label: string, key: string): Promise<void> {
  await act(async () => {
    field(label).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
function boxes(): number {
  return useStore.getState().project.scene.objects.filter(isRegistrationBox).length;
}
function scaledScene(): Scene {
  useStore.getState().addRegistrationBox(80, 40);
  const live = useStore.getState().project;
  return {
    ...live.scene,
    objects: live.scene.objects.map((object) =>
      isRegistrationBox(object)
        ? { ...object, transform: { ...object.transform, scaleX: 2, scaleY: 0.5 } }
        : object,
    ),
  };
}

describe('jig outline layout', () => {
  it('applies a change when focus leaves the fields, from the scaled outline size', async () => {
    const onReplace = vi.fn<(spec: RegistrationJigSetSpec, removed: ReadonlySet<string>) => void>();
    await act(async () =>
      root.render(
        <RegistrationJigOutlineControls
          scene={scaledScene()}
          onReplace={onReplace}
          onRemove={() => undefined}
        />,
      ),
    );
    expect(field('Registration box width').value).toBe('160');
    expect(field('Registration box height').value).toBe('20');
    await leave('Registration box width');
    expect(onReplace).not.toHaveBeenCalled();
    await type('Registration box width', '170');
    await leave('Registration box width');
    expect(onReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        outline: { kind: 'rectangle', widthMm: 170, heightMm: 20 },
        removedArtwork: 'keep',
      }),
      new Set(),
    );
    expect(host.querySelector('button')?.textContent).not.toBe('Apply layout');
  });

  it('applies on Enter, and Escape returns the fields to the outlines', async () => {
    useStore.getState().addRegistrationBox(80, 40);
    await act(async () => root.render(<TestControls />));
    await type('Jig columns', '3');
    await press('Jig columns', 'Enter');
    expect(boxes()).toBe(3);

    const undo = useStore.getState().undoStack.length;
    await type('Jig columns', '5');
    await press('Jig columns', 'Escape');
    expect(field('Jig columns').value).toBe('3');
    await leave('Jig columns');
    expect(boxes()).toBe(3);
    expect(useStore.getState().undoStack).toHaveLength(undo);
  });

  it('keeps the artwork of removed pieces and reports it for removal', async () => {
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
      rows: 1,
      columns: 3,
      spacingX: 5,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      }),
    );
    useStore.getState().centerSelectionInRegistrationBox();
    await act(async () => root.render(<TestControls />));
    await type('Jig columns', '2');
    await leave('Jig columns');

    const artwork = useStore
      .getState()
      .project.scene.objects.filter((object) => !isRegistrationBox(object));
    expect(boxes()).toBe(2);
    expect(artwork).toHaveLength(3);
    expect(leftover.size).toBe(1);
    expect(artwork.some((object) => leftover.has(object.id))).toBe(true);
  });

  it.each(['', '0', '1.5', '10000'])(
    'says why grid %s cannot be used and leaves the scene alone',
    async (rows) => {
      await act(async () => root.render(<TestControls />));
      await type('Jig rows', rows);
      await type('Jig columns', '10000');
      const message = rows === '10000' ? 'at most 10000' : 'Rows must';
      expect(host.textContent).toContain(message);
      const before = useStore.getState();
      await leave('Jig columns');
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(host.textContent).toContain(message);
      expect(field('Jig rows').value).toBe('1');
    },
  );

  it('creates the outlines from the fields when there are none', async () => {
    await act(async () => root.render(<TestControls />));
    const create = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Create outlines',
    );
    if (create === undefined) throw new Error('Missing Create outlines');
    await act(async () => create.click());
    expect(boxes()).toBe(1);
  });
});
