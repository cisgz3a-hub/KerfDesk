import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import { createLayer, createProject, type Layer } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { SelectedOperationInspector } from './SelectedOperationInspector';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

describe('operation inspector artwork ownership', () => {
  it.each(['Make unique', 'Add operation'])(
    'keeps the next edit owned by the new operation after %s',
    async (action) => {
      loadFixture(true);
      const mounted = await mountInspector();
      try {
        expect(powerInput(mounted.host).value).toBe('17');
        const button = [...mounted.host.querySelectorAll('button')].find(
          (element) => element.textContent === action,
        );
        if (button === undefined) throw new Error('Operation action missing');
        await act(async () => button.click());
        const scene = useStore.getState().project.scene;
        const cloneId = scene.layers.at(-1)!.id;
        if (action === 'Add operation') {
          const select = mounted.host.querySelector<HTMLSelectElement>(
            'select[aria-label="Operation to inspect"]',
          );
          if (select === null) throw new Error('Operation picker missing');
          await act(async () => {
            select.value = cloneId;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        expect(powerInput(mounted.host).value).toBe('17');
        const beforeEdit = output('chosen');

        await editPower(powerInput(mounted.host), '23');

        expect(powerInput(mounted.host).value).toBe('23');
        expect(output('chosen').find((group) => group.layerId === cloneId)?.power).toBe(23);
        expect(output('peer').map((group) => group.power)).toEqual([30]);
        if (action === 'Add operation') {
          expect(output('chosen').filter((group) => group.layerId !== cloneId)).toEqual(
            beforeEdit.filter((group) => group.layerId !== cloneId),
          );
        }
        expect(useStore.getState().project.scene.objects[0]?.operationOverride).toMatchObject({
          power: 17,
          byOperation: { [cloneId]: { power: 23 } },
        });
      } finally {
        await mounted.unmount();
      }
    },
  );

  it('displays and edits the explicit retained artwork without changing canvas selection or another owner', async () => {
    loadFixture(false);
    const mounted = await mountInspector();
    try {
      expect(output('chosen').map((group) => group.power)).toEqual([17]);
      expect(powerInput(mounted.host).value).toBe('17');
      await editPower(powerInput(mounted.host), '23');
      expect(output('chosen').map((group) => group.power)).toEqual([23]);
      expect(output('peer').map((group) => group.power)).toEqual([30]);
      expect(useStore.getState().selectedObjectId).toBeNull();
      expect(useStore.getState().additionalSelectedIds.size).toBe(0);
      expect(useStore.getState().undoStack).toHaveLength(1);
      await act(async () => useStore.getState().undo());
      expect(powerInput(mounted.host).value).toBe('17');
      expect(output('chosen').map((group) => group.power)).toEqual([17]);
    } finally {
      await mounted.unmount();
    }
  });

  it('applies and restores power-mode choices in the existing artwork override dialog', async () => {
    loadFixture(true, 'constant');
    const mounted = await mountInspector();
    try {
      let previousChoice = 'constant';
      for (const choice of ['dynamic', 'constant', 'auto']) {
        const open = [...mounted.host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Advanced cut settings',
        );
        if (open === undefined) throw new Error('Advanced settings missing');
        await act(async () => open.click());
        const field = document.querySelector<HTMLSelectElement>('select[name="powerMode"]');
        if (field === null || field.form === null) throw new Error('Power mode form missing');
        expect(field.value).toBe(previousChoice);
        const form = field.form;
        field.value = choice;
        expect(form.checkValidity()).toBe(true);
        await act(async () => form.requestSubmit());

        const group = output('chosen')[0];
        if (group?.kind !== 'cut') throw new Error('Expected selected vector output');
        expect(group.powerMode).toBe(choice === 'auto' ? undefined : choice);
        const peer = output('peer')[0];
        if (peer?.kind !== 'cut') throw new Error('Expected peer vector output');
        expect(peer.powerMode).toBe('constant');
        const saved = deserializeProject(serializeProject(useStore.getState().project));
        if (saved.kind !== 'ok') throw new Error(JSON.stringify(saved));
        await act(async () => useStore.setState({ project: saved.project }));
        previousChoice = choice;
      }
    } finally {
      await mounted.unmount();
    }
  });
});

function loadFixture(selected: boolean, powerMode?: Layer['powerMode']): void {
  const source = { ...createLayer({ id: 'shared', color: '#000000' }), powerMode };
  const objects = ['chosen', 'peer'].map((id) => ({
    ...svgObj(id, ['#000000']),
    operationIds: [source.id],
    ...(id === 'chosen' ? { operationOverride: { power: 17, speed: 600 } } : {}),
  }));
  const loaded = deserializeProject(
    serializeProject({ ...createProject(), scene: { objects, layers: [source] } }),
  );
  if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
  useStore.setState({
    project: loaded.project,
    selectedObjectId: selected ? 'chosen' : null,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function output(objectId: string) {
  const { project } = useStore.getState();
  return compileJob(
    { ...project.scene, objects: project.scene.objects.filter((object) => object.id === objectId) },
    project.device,
  ).groups.filter((group) => group.kind !== 'cnc');
}

function Inspector(): JSX.Element {
  const objects = useStore((state) => state.project.scene.objects);
  const selected = useStore((state) => state.selectedObjectId);
  return (
    <SelectedOperationInspector
      objects={objects.filter((object) => object.id === 'chosen')}
      selectionActive={selected !== null}
    />
  );
}

async function mountInspector() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Inspector />));
  return { host, unmount: async () => act(async () => root.unmount()) };
}

function powerInput(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[aria-label^="Power for "]');
  if (input === null) throw new Error('Power field missing');
  return input;
}

async function editPower(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}
