import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useMaterialLibraryPersistence } from '../app/use-material-library-persistence';
import { libraryDocument } from '../state/material-library-collection';
import { restoreCollection } from '../state/material-library-persistence';
import { useToastStore } from '../state/toast-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { MaterialExperimentDialog } from './MaterialExperimentDialog';
import { testExperiment } from './material-experiment.test-fixture';
import { deserializeMaterialLibrary } from '../../io/material-library';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  resetStore();
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
  localStorage.clear();
});
it('selects a cell, captures observations and exports a portable recipe through the real dialog', async () => {
  resetStore();
  useStore.getState().createLibrary('Workshop');
  const experiment = testExperiment();
  useStore.getState().upsertMaterialExperiment(experiment);
  let exported = '';
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => ({
      displayName: 'evidence.lfml.json',
      write: async (data) => {
        exported = String(data);
      },
    }),
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <Persistence />
          <MaterialExperimentDialog experiment={experiment} onClose={() => undefined} />
        </PlatformProvider>,
      ),
    );
    change(host, 'Experiment material', 'Birch');
    change(host, 'Experiment cell', '0-1');
    change(host, 'Cell observation', 'Clean cut, slight soot');
    change(host, 'Experiment recipe name', 'Test winner');
    click(host, 'Save selected cell as recipe');
    expect(useStore.getState().materialLibrary?.entries[0]?.recipe).toMatchObject({
      speed: 3000,
      power: 40,
    });
    expect(useStore.getState().materialLibrary?.experiments?.[0]?.cells[1]?.observation).toBe(
      'Clean cut, slight soot',
    );
    click(host, 'Save experiment');
    await act(async () => click(host, 'Export library with evidence…'));
    const result = deserializeMaterialLibrary(exported);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.library.experiments?.[0]?.selectedCellId).toBe('0-1');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('keeps the saved experiment and cell recipe across project replacement, collection reopen and reload', async () => {
  useStore.getState().createLibrary('Other materials');
  const otherPayload = useStore.getState().savedLibraries.libraries['other-materials']?.payload;
  const id = useStore.getState().createLibrary('Workshop')!;
  const experiment = testExperiment();
  useStore.getState().upsertMaterialExperiment(experiment);
  const mounted = await mountExperiment(experiment);
  let root = mounted.root;
  try {
    change(mounted.host, 'Experiment material', 'Birch');
    change(mounted.host, 'Experiment cell', '0-1');
    change(mounted.host, 'Cell observation', 'Clean cut, slight soot');
    change(mounted.host, 'Experiment recipe name', 'Test winner');
    click(mounted.host, 'Save selected cell as recipe');
    click(mounted.host, 'Save experiment');
    const saved = useStore.getState().materialLibrary!;
    const stored = restoreCollection(localStorage)!;
    expect(libraryDocument(stored, id)).toEqual(saved);
    expect(stored.libraries['other-materials']?.payload).toBe(otherPayload);
    await act(async () => {
      useStore.getState().setProject(createProject());
    });
    expect(useStore.getState().materialLibrary).toBe(saved);
    act(() => useStore.getState().setMaterialLibrary(null));
    expect(useStore.getState().openSavedLibrary(id)).toBe(true);
    expect(useStore.getState().materialLibrary).toEqual(saved);
    await act(async () => root.unmount());
    resetStore();
    root = createRoot(mounted.host);
    await act(async () => root.render(<Persistence />));
    expect(useStore.getState().materialLibrary).toEqual(saved);
    expect(
      useStore.getState().materialLibrary?.experiments?.[0]?.cells[1]?.recipeRef,
    ).toMatchObject({
      kind: 'material',
      id: saved.entries[0]?.id,
    });
  } finally {
    await act(async () => root.unmount());
    mounted.host.remove();
  }
});

it('refuses saving an old editor into another library', async () => {
  useStore.getState().createLibrary('Workshop');
  const experiment = testExperiment();
  useStore.getState().upsertMaterialExperiment(experiment);
  const mounted = await mountExperiment(experiment);
  try {
    change(mounted.host, 'Experiment material', 'Changed in stale editor');
    await act(async () => {
      useStore.getState().createLibrary('Other materials');
    });
    const other = useStore.getState().materialLibrary;
    click(mounted.host, 'Save experiment');
    expect(mounted.host.textContent).toContain('Open the original library before saving');
    expect(useStore.getState().materialLibrary).toBe(other);
    expect(other?.experiments).toBeUndefined();
  } finally {
    await act(async () => mounted.root.unmount());
    mounted.host.remove();
  }
});

it('warns about failed session persistence and keeps the edited experiment available for export', async () => {
  useStore.getState().createLibrary('Workshop');
  const experiment = testExperiment();
  useStore.getState().upsertMaterialExperiment(experiment);
  const mounted = await mountExperiment(experiment);
  try {
    change(mounted.host, 'Experiment material', 'Birch');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    click(mounted.host, 'Save experiment');
    expect(useStore.getState().materialLibrary?.experiments?.[0]?.material).toBe('Birch');
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        variant: 'warning',
        message: expect.stringContaining('could not be saved for next session'),
      }),
    );
    expect(useStore.getState().listSavedLibraries()[0]?.name).toBe('Workshop');
  } finally {
    await act(async () => mounted.root.unmount());
    mounted.host.remove();
  }
});

function Persistence(): null {
  useMaterialLibraryPersistence();
  return null;
}

async function mountExperiment(experiment: ReturnType<typeof testExperiment>) {
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <Persistence />
        <MaterialExperimentDialog experiment={experiment} onClose={() => undefined} />
      </PlatformProvider>,
    ),
  );
  return { host, root };
}

function change(host: HTMLElement, label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    input.value = value;
    Simulate.change(input);
  });
}
function click(host: HTMLElement, text: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (element) => element.textContent === text,
  )!;
  expect(button.disabled).toBe(false);
  act(() => Simulate.click(button));
}
