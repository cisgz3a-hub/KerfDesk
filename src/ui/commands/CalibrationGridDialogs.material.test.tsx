// Material Test placement (ADR-381): Generate adds the test to the open
// design, or opens it as a new project after the save prompt. It never
// replaces the design in place.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { createLayer } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MaterialDialog } from './CalibrationGridDialogs';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  useStore.getState().importSvgObject(svgObj('design', ['#ff0000']));
  useStore.setState({ undoStack: [], redoStack: [], dirty: true });
});
afterEach(() => {
  resetStore();
  localStorage.clear();
  document.body.innerHTML = '';
});

async function renderDialog(onClose = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={mockPlatform()}>
        <MaterialDialog onClose={onClose} />
      </PlatformProvider>,
    ),
  );
  return {
    host,
    onClose,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function generate(host: HTMLElement): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Generate',
  );
  await act(async () => button?.click());
}

function lastToast() {
  return useToastStore.getState().toasts.at(-1);
}

describe('MaterialDialog placement', () => {
  it('adds the test beside the design, selected and undoable in one step', async () => {
    const before = useStore.getState().project.scene;
    const view = await renderDialog();
    try {
      await generate(view.host);
      const state = useStore.getState();
      const ids = state.project.scene.objects.map((object) => object.id);
      expect(ids[0]).toBe('design');
      expect(state.project.scene.objects[0]).toBe(before.objects[0]);
      expect(state.project.scene.layers.slice(0, before.layers.length)).toEqual(before.layers);
      const testIds = ids.filter((id) => id.startsWith('material-test-'));
      expect(testIds.filter((id) => id.includes('-cell-'))).toHaveLength(100);
      expect(state.project.scene.groups?.map((group) => group.name)).toEqual(['Material test']);
      expect([state.selectedObjectId, ...state.additionalSelectedIds]).toEqual(testIds);
      expect(view.onClose).toHaveBeenCalledOnce();
      expect(lastToast()).toMatchObject({ variant: 'success' });
      expect(lastToast()?.message).toContain('Added Material test (100 cells) in free space');
      expect(useConfirmSaveStore.getState().request).toBeNull();

      const reloaded = deserializeProject(serializeProject(state.project));
      expect(reloaded.kind).toBe('ok');

      useStore.getState().undo();
      expect(useStore.getState().project.scene).toBe(before);
    } finally {
      await view.close();
    }
  });

  it('gives a second test its own ids and name', async () => {
    const first = await renderDialog();
    await generate(first.host);
    await first.close();
    const second = await renderDialog();
    try {
      await generate(second.host);
      const groups = useStore.getState().project.scene.groups ?? [];
      expect(groups.map((group) => group.name)).toEqual(['Material test', 'Material test 2']);
      expect(lastToast()?.message).toContain('Material test 2');
    } finally {
      await second.close();
    }
  });

  it('opens the test as a new project once the save prompt is answered', async () => {
    const view = await renderDialog();
    try {
      const radio = view.host.querySelector<HTMLInputElement>('input[value="new-project"]');
      await act(async () => radio?.click());
      await generate(view.host);
      expect(view.onClose).toHaveBeenCalledOnce();
      const request = useConfirmSaveStore.getState().request;
      expect(request?.action).toBe('open the material test as a new project');
      await act(async () => useConfirmSaveStore.getState().choose('discard'));
      const objects = useStore.getState().project.scene.objects;
      expect(objects.some((object) => object.id === 'design')).toBe(false);
      expect(objects.every((object) => object.id.startsWith('material-test-'))).toBe(true);
      expect(lastToast()?.message).toBe('Opened a new project with the material test (100 cells).');
    } finally {
      await view.close();
    }
  });

  it('keeps the design when the save prompt is cancelled', async () => {
    const before = useStore.getState().project;
    const view = await renderDialog();
    try {
      const radio = view.host.querySelector<HTMLInputElement>('input[value="new-project"]');
      await act(async () => radio?.click());
      await generate(view.host);
      await act(async () => useConfirmSaveStore.getState().choose('cancel'));
      expect(useStore.getState().project).toBe(before);
    } finally {
      await view.close();
    }
  });

  it('refuses a test the project cannot hold and keeps the dialog open', async () => {
    const layers = Array.from({ length: 250 }, (_, index) =>
      createLayer({ id: `op-${index}`, color: `#00${index.toString(16).padStart(4, '0')}` }),
    );
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, layers } },
    }));
    const before = useStore.getState().project.scene;
    const view = await renderDialog();
    try {
      await generate(view.host);
      expect(useStore.getState().project.scene).toBe(before);
      expect(view.onClose).not.toHaveBeenCalled();
      expect(lastToast()).toMatchObject({ variant: 'error' });
      expect(lastToast()?.message).toContain('Open it as a new project instead.');
    } finally {
      await view.close();
    }
  });
});
