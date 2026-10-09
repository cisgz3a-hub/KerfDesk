import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { materializeReliefAuthoring } from '../../core/relief/materialize-relief-authoring';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  CreateEditableReliefButton,
  CreateEditableReliefWorkflow,
} from './CreateEditableReliefButton';
import { composeReliefInWorker } from './relief-authoring-worker-client';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import type { ReliefAuthoringMaterializationResult } from '../../core/relief/materialize-relief-authoring';

vi.mock('./relief-authoring-worker-client', () => ({
  composeReliefInWorker: vi.fn(async (document) => materializeReliefAuthoring(document)),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
function button(text: string): HTMLButtonElement {
  const value = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  if (value === undefined) throw new Error(`Missing button ${text}`);
  return value;
}
function current(): HeightfieldReliefObject {
  return useStore
    .getState()
    .project.scene.objects.find((item) => item.kind === 'relief') as HeightfieldReliefObject;
}

describe('editable relief creation in an empty project', () => {
  it('opens a sculptable base component and retains the first stroke through undo and save/reopen', async () => {
    await act(async () => root.render(<CreateEditableReliefButton />));
    await act(async () => button('Create editable relief…').click());
    await act(async () => button('Create relief').click());
    expect(current().reliefAuthoring?.components).toHaveLength(1);
    const source = current().reliefSource;
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    canvas.setPointerCapture = () => undefined;
    canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    const pointer = { pointerId: 1, clientX: 50, clientY: 50 };
    await act(async () => {
      Simulate.pointerDown(canvas, { button: 0, ...pointer });
      Simulate.pointerUp(canvas, pointer);
    });
    expect(current().reliefAuthoring?.strokes).toHaveLength(1);
    expect(current().reliefSource.samplesBase64).not.toBe(source.samplesBase64);
    const reopened = deserializeProject(serializeProject(useStore.getState().project));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind === 'ok') expect(reopened.project.scene.objects[0]).toEqual(current());
    await act(async () => useStore.getState().undo());
    expect(current().reliefSource).toEqual(source);
    expect(current().reliefAuthoring?.strokes).toHaveLength(0);
  });
  it('rejects a late blank-relief result after another project becomes active', async () => {
    let candidate: ReliefAuthoringDocument | undefined;
    let resolve: ((result: ReliefAuthoringMaterializationResult) => void) | undefined;
    vi.mocked(composeReliefInWorker).mockImplementationOnce((document) => {
      candidate = document;
      return new Promise((done) => {
        resolve = done;
      });
    });
    await act(async () => root.render(<CreateEditableReliefButton />));
    await act(async () => button('Create editable relief…').click());
    await act(async () => button('Create relief').click());
    await act(async () =>
      useStore.getState().setProject({ ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG }),
    );
    const replacement = useStore.getState().project;
    if (candidate === undefined || resolve === undefined)
      throw new Error('Missing pending relief creation.');
    await act(async () =>
      resolve?.(materializeReliefAuthoring(candidate as ReliefAuthoringDocument)),
    );
    expect(useStore.getState().project).toBe(replacement);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(host.textContent).toContain('The project changed during preparation');
  });
  it('prevents invalid dimensions from starting composition', async () => {
    await act(async () => root.render(<CreateEditableReliefButton />));
    await act(async () => button('Create editable relief…').click());
    const width = host.querySelector('[aria-label="Relief width (mm)"]') as HTMLInputElement;
    const calls = vi.mocked(composeReliefInWorker).mock.calls.length;
    await act(async () => {
      width.value = '';
      Simulate.change(width);
    });
    expect(button('Create relief').disabled).toBe(true);
    await act(async () => button('Create relief').click());
    expect(vi.mocked(composeReliefInWorker).mock.calls).toHaveLength(calls);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });
  it('opens from the stable host without a second launcher and hands editor Close to its owner', async () => {
    const close = vi.fn();
    await act(async () => root.render(<CreateEditableReliefWorkflow onClose={close} />));
    expect(host.querySelector('.lf-dialog-title')?.textContent).toBe('Create editable relief');
    expect(
      [...host.querySelectorAll('button')].some(
        (item) => item.textContent === 'Create editable relief…',
      ),
    ).toBe(false);
    await act(async () => button('Create relief').click());
    expect(current().reliefAuthoring?.components).toHaveLength(1);
    expect(host.querySelector('.lf-dialog-title')?.textContent).toBe('Edit relief components');
    await act(async () => button('Close').click());
    expect(close).toHaveBeenCalledTimes(1);
  });
});
