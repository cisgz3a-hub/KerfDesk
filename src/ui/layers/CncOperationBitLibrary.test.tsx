import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { useStore } from '../state';
import { EMPTY_CNC_LIBRARY } from '../state/cnc-library-persistence';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function renderFields(): Promise<void> {
  resetStore();
  useStore.setState({
    cncLibrary: EMPTY_CNC_LIBRARY,
    project: {
      ...createProject(),
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: DEFAULT_CNC_MACHINE_CONFIG.tools.filter((tool) => tool.id === 'em-3175'),
      },
      scene: {
        layers: ['chosen', 'peer'].map((id) => ({
          ...createLayer({ id, color: id === 'chosen' ? '#123456' : '#abcdef' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS },
        })),
        objects: [],
      },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ConnectedFields />));
}

function libraryDetails(): HTMLDetailsElement {
  const summary = [...host.querySelectorAll('summary')].find(
    (item) => item.textContent === 'Add another bit',
  );
  const details = summary?.parentElement;
  if (!(details instanceof HTMLDetailsElement)) throw new Error('Library disclosure missing');
  return details;
}

async function toggleLibrary(open: boolean): Promise<void> {
  await act(async () => {
    const details = libraryDetails();
    details.open = open;
    details.dispatchEvent(new Event('toggle'));
  });
}

async function typeInto(label: string, value: string): Promise<void> {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (input === null) throw new Error(`${label} missing`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  resetStore();
  useStore.setState({ cncLibrary: EMPTY_CNC_LIBRARY });
});

describe('operation bit library', () => {
  it('adds and selects a new bit locally without changing the job default or other operations', async () => {
    await renderFields();
    const before = useStore.getState().project;
    expect(host.querySelector('[aria-label="New bit name"]')).toBeNull();
    await toggleLibrary(true);
    expect(host.querySelector('[aria-label="Search bit catalog"]')).not.toBeNull();
    await typeInto('New bit name', 'My 2 mm cutter');
    await typeInto('New bit diameter (mm)', '2');
    await toggleLibrary(false);
    await toggleLibrary(true);
    expect(host.querySelector<HTMLInputElement>('[aria-label="New bit name"]')?.value).toBe(
      'My 2 mm cutter',
    );
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Add bit"]')?.click());
    const added = useStore.getState().cncLibrary.customTools[0];
    expect(added).toMatchObject({ name: 'My 2 mm cutter', diameterMm: 2, fluteCount: 2 });
    if (added === undefined) throw new Error('New cutter missing');
    const afterAdd = useStore.getState().project;
    if (afterAdd.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(afterAdd.scene).toBe(before.scene);
    expect(afterAdd.machine.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(afterAdd.machine.tools).toHaveLength(2);
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Bit for #123456"]');
      if (select === null) throw new Error('Bit selector missing');
      select.value = added.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const selected = useStore.getState().project;
    expect(selected.scene.layers[0]?.cnc?.toolId).toBe(added.id);
    expect(selected.scene.layers[1]).toBe(before.scene.layers[1]);
    expect(selected.machine).toBe(afterAdd.machine);
  });
});
