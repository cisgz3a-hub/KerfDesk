import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiAssistant, AiDraft, AiRequest, AiStatus } from '../../core/ai/assistant';
import { captureMaterialRecipe } from '../../core/material-library';
import type { ExperimentPhoto } from '../../core/material-library/material-experiment';
import { createLayer } from '../../core/scene';
import {
  MATERIAL_LIBRARY_FORMAT,
  MATERIAL_LIBRARY_SCHEMA_VERSION,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { AiAssistantDialog } from './AiAssistantDialog';
const photoReader = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../material-library/experiment-photo', () => ({ readExperimentPhoto: photoReader.read }));
const status: AiStatus = { configured: true, secureStorage: true, model: 'fake-model' };
const draft: AiDraft = {
  title: 'Reviewed triangle',
  explanation: 'Review this draft.',
  matches: [],
  paths: [
    {
      closed: true,
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 5, y: 15 },
      ],
    },
  ],
};
let host: HTMLDivElement, root: Root | null;
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function fakeAssistant() {
  return {
    status: vi.fn(async () => status),
    configure: vi.fn(async () => status),
    forget: vi.fn(async () => ({ ...status, configured: false })),
    generate: vi.fn(async (_request: AiRequest, _signal: AbortSignal) => draft),
  } satisfies AiAssistant;
}
async function render(assistant = fakeAssistant()) {
  const close = vi.fn(),
    requestPort = vi.fn(async () => null);
  const adapter: PlatformAdapter = {
    id: 'mock',
    aiAssistant: assistant,
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort },
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={adapter}>
        <AiAssistantDialog onClose={close} />
      </PlatformProvider>,
    ),
  );
  return { assistant, close, requestPort };
}
function field<T extends HTMLElement>(label: string): T {
  return host.querySelector<T>(`[aria-label="${label}"]`)!;
}
function button(name: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === name)!;
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click());
}
async function change(label: string, value: string): Promise<void> {
  const input = field<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(label);
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}
async function request(): Promise<void> {
  await change('AI prompt', 'Make a triangle.');
  await click('Request draft from OpenAI');
}
async function photo(name: string): Promise<void> {
  const input = field<HTMLInputElement>('AI reference photo');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['test'], name, { type: 'image/png' })],
  });
  await act(async () => Simulate.change(input));
}
function savedLibrary(): MaterialLibraryDocument {
  return {
    format: MATERIAL_LIBRARY_FORMAT,
    librarySchemaVersion: MATERIAL_LIBRARY_SCHEMA_VERSION,
    libraryId: 'saved',
    name: 'Saved recipes',
    entries: [
      {
        id: 'birch',
        title: 'Birch test',
        materialName: 'Birch',
        description: 'Manually observed coupon',
        revision: 'r1',
        recipe: {
          ...captureMaterialRecipe(createLayer({ id: 'test', color: '#000000' })),
          power: 25,
          speed: 3000,
        },
      },
    ],
  };
}
beforeEach(() => {
  resetStore();
  photoReader.read.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.unstubAllGlobals();
});
describe('assistant review ownership', () => {
  it('opens and saves configuration without sending a request or changing artwork', async () => {
    const { assistant, requestPort } = await render();
    const before = useStore.getState();
    expect(assistant.generate).not.toHaveBeenCalled();
    await change('OpenAI API key', 'fake-test-key');
    await change('AI model ID', 'fake-model');
    await click('Save connection');
    expect(assistant.configure).toHaveBeenCalledExactlyOnceWith('fake-test-key', 'fake-model');
    expect(field<HTMLInputElement>('OpenAI API key').value).toBe('');
    expect(assistant.generate).not.toHaveBeenCalled();
    expect(requestPort).not.toHaveBeenCalled();
    expect(useStore.getState()).toBe(before);
  });
  it('adds only reviewed geometry through ordinary Undo, ignoring model settings and executable text', async () => {
    const source = svgObj('existing', ['#000000']);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [source],
          layers: [createLayer({ id: 'existing-layer', color: '#000000' })],
        },
      },
    }));
    useStore.getState().selectObject('existing');
    useStore
      .getState()
      .selectPathNode({ objectId: 'existing', pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    const assistant = fakeAssistant();
    assistant.generate.mockResolvedValue({
      ...draft,
      settings: { power: 97, speed: 999991 },
      gcode: 'M3 S9999',
    } as AiDraft);
    const { close, requestPort } = await render(assistant);
    const before = useStore.getState().project;
    await request();
    expect(useStore.getState().project).toBe(before);
    expect(host.querySelector('[aria-label="Generated vector preview"] polygon')).not.toBeNull();
    await click('Add reviewed design');
    const after = useStore.getState();
    expect(after.project.scene.objects).toHaveLength(2);
    expect(after.project.scene.objects[0]).toBe(source);
    expect(after.selectedPathNode).toBeNull();
    expect(after.selectedPathNodes).toEqual([]);
    expect(after.selectionReference).toBeNull();
    expect(after.project.machine).toBe(before.machine);
    expect(after.undoStack).toEqual([before]);
    expect(after.project.scene.layers.at(-1)?.speed).not.toBe(999991);
    expect(JSON.stringify(after.project.scene)).not.toContain('M3 S9999');
    expect(requestPort).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    await act(async () => after.undo());
    expect(useStore.getState().project).toBe(before);
  });
  it.each(['project', 'epoch'] as const)('blocks Apply after %s changes', async (kind) => {
    const { close } = await render();
    await request();
    await act(async () =>
      useStore.setState((state) =>
        kind === 'project'
          ? { project: { ...state.project, notes: 'changed' } }
          : { projectDocumentEpoch: state.projectDocumentEpoch + 1 },
      ),
    );
    const before = useStore.getState();
    await click('Add reviewed design');
    expect(host.textContent).toContain('The project changed');
    expect(close).not.toHaveBeenCalled();
    expect(useStore.getState()).toBe(before);
  });
  it('refuses Apply before Undo when a draft would exceed the existing operation budget', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: Array.from({ length: 256 }, (_, i) =>
            createLayer({ id: `layer-${i}`, color: `#${i.toString(16).padStart(6, '0')}` }),
          ),
        },
      },
    }));
    const { close } = await render();
    await request();
    const before = useStore.getState();
    await click('Add reviewed design');
    expect(host.textContent).toContain('scene.layers');
    expect(useStore.getState()).toBe(before);
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'unmount', 'project'] as const)(
    'ignores delayed generation after %s',
    async (kind) => {
      const pending = deferred<AiDraft>(),
        assistant = fakeAssistant();
      assistant.generate.mockReturnValue(pending.promise);
      await render(assistant);
      await request();
      const signal = assistant.generate.mock.calls[0]![1];
      if (kind === 'cancel') {
        await click('Cancel request');
        expect(button('Request draft from OpenAI').disabled).toBe(true);
      }
      if (kind === 'unmount') {
        await act(async () => root?.unmount());
        root = null;
      }
      if (kind === 'project') await act(async () => useStore.getState().newProject());
      const before = useStore.getState();
      await act(async () => pending.resolve(draft));
      if (kind !== 'project') expect(signal.aborted).toBe(true);
      expect(host.querySelector('[aria-label="Generated vector preview"]')).toBeNull();
      expect(useStore.getState()).toBe(before);
    },
  );
  it('uses only allowed material IDs and keeps saved recipe review frozen without applying settings', async () => {
    const library = savedLibrary();
    useStore.setState({ materialLibrary: library });
    const assistant = fakeAssistant();
    assistant.generate.mockResolvedValue({
      ...draft,
      paths: [],
      matches: [{ id: 'material:birch', reason: 'Similar appearance; unqualified.' }],
    });
    await render(assistant);
    await change('AI task', 'material');
    const before = useStore.getState().project;
    await request();
    expect(assistant.generate.mock.calls[0]![0].candidates.map((item) => item.id)).toEqual([
      'material:birch',
    ]);
    await act(async () =>
      useStore.setState({
        materialLibrary: {
          ...library,
          entries: [
            {
              ...library.entries[0]!,
              revision: 'r2',
              recipe: { ...library.entries[0]!.recipe, power: 90 },
            },
          ],
        },
      }),
    );
    expect(host.textContent).toContain('Revision r1');
    expect(host.textContent).toContain('25% power');
    expect(button('Add reviewed design')).toBeUndefined();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
    assistant.generate.mockResolvedValue({
      ...draft,
      paths: [],
      matches: [{ id: 'not-reviewed', reason: 'Invented' }],
    });
    await click('Request draft from OpenAI');
    expect(host.textContent).toContain('outside the reviewed library');
    expect(useStore.getState().project).toBe(before);
  });
  it('does not let an initial delayed status read overwrite newly saved configuration', async () => {
    const pending = deferred<AiStatus>(),
      assistant = fakeAssistant();
    assistant.status.mockReturnValue(pending.promise);
    await render(assistant);
    await change('OpenAI API key', 'fake-test-key');
    await change('AI model ID', 'fake-model');
    await click('Save connection');
    await change('AI prompt', 'Triangle');
    await act(async () => pending.resolve({ ...status, configured: false, model: '' }));
    expect(button('Request draft from OpenAI').disabled).toBe(false);
    expect(assistant.generate).not.toHaveBeenCalled();
  });
  it('searches the complete library before limiting the reviewed request to 50 candidates', async () => {
    const library = savedLibrary(),
      original = library.entries[0]!;
    const entries = Array.from({ length: 54 }, (_, i) => ({
      ...original,
      id: `recipe-${i}`,
      title: i === 53 ? 'Special beyond fifty' : `Recipe ${i}`,
    }));
    useStore.setState({ materialLibrary: { ...library, entries } });
    const assistant = fakeAssistant();
    assistant.generate.mockResolvedValue({ ...draft, paths: [] });
    await render(assistant);
    await change('AI task', 'material');
    expect(host.textContent).toContain('50 matching saved recipes included');
    await change('AI saved recipe filter', 'Special beyond fifty');
    expect(host.textContent).toContain('1 matching saved recipe included');
    await request();
    expect(
      assistant.generate.mock.calls[0]![0].candidates.map((candidate) => candidate.id),
    ).toEqual(['material:recipe-53']);
    expect(useStore.getState().undoStack).toEqual([]);
  });
});
describe('reference photo ownership', () => {
  it('blocks requests during preparation, clears old previews and retains the newest selected photo', async () => {
    const a = deferred<ExperimentPhoto>(),
      b = deferred<ExperimentPhoto>();
    const photoA = { dataUrl: 'data:image/jpeg;base64,QQ==', width: 11, height: 11 };
    const photoB = { dataUrl: 'data:image/jpeg;base64,Qg==', width: 22, height: 22 };
    photoReader.read
      .mockResolvedValueOnce(photoA)
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    const { assistant } = await render();
    await change('AI prompt', 'Triangle');
    await photo('initial.png');
    expect(host.querySelector('figure img')).not.toBeNull();
    await photo('a.png');
    expect(host.querySelector('figure img')).toBeNull();
    expect(button('Request draft from OpenAI').disabled).toBe(true);
    await photo('b.png');
    await act(async () => b.resolve(photoB));
    await act(async () => a.resolve(photoA));
    expect(host.querySelector('figure img')?.getAttribute('src')).toBe(photoB.dataUrl);
    await click('Request draft from OpenAI');
    expect(assistant.generate.mock.calls[0]![0].photo).toBe(photoB.dataUrl);
  });
  it.each(['cancel', 'unmount'] as const)('rejects a delayed photo after %s', async (kind) => {
    const pending = deferred<ExperimentPhoto>();
    photoReader.read.mockReturnValue(pending.promise);
    const { assistant } = await render();
    await change('AI prompt', 'Triangle');
    await photo('a.png');
    if (kind === 'cancel') await click('Cancel photo preparation');
    else {
      await act(async () => root?.unmount());
      root = null;
    }
    await act(async () =>
      pending.resolve({ dataUrl: 'data:image/jpeg;base64,QQ==', width: 11, height: 11 }),
    );
    expect(host.querySelector('figure img')).toBeNull();
    expect(assistant.generate).not.toHaveBeenCalled();
    if (kind === 'cancel') {
      await click('Request draft from OpenAI');
      expect(assistant.generate.mock.calls[0]![0].photo).toBeNull();
    }
  });
});
