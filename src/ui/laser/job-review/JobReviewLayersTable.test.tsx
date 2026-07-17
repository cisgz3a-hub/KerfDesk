import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  type Layer,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JobReviewLayersTable } from './JobReviewLayersTable';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  resetStore();
});

function seedLayers(layers: ReadonlyArray<Layer>, machineKind: 'laser' | 'cnc'): void {
  useStore.setState({
    project: {
      ...createProject(),
      ...(machineKind === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
      scene: { ...EMPTY_SCENE, objects: [], layers: [...layers] },
    },
  });
}

async function render(machineKind: 'laser' | 'cnc'): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(<JobReviewLayersTable machineKind={machineKind} />);
  });
}

function numberInput(label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input "${label}" not found`);
  return input;
}

async function typeAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

function storedLayer(id: string): Layer {
  const layer = useStore.getState().project.scene.layers.find((entry) => entry.id === id);
  if (layer === undefined) throw new Error(`Layer ${id} missing from the store`);
  return layer;
}

describe('JobReviewLayersTable', () => {
  it('edits laser power/speed/passes through the store with clamping, and toggles air', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer], 'laser');
    await render('laser');

    await typeAndBlur(numberInput(`Power % for ${layer.name}`), '55');
    expect(storedLayer('red').power).toBe(55);

    await typeAndBlur(numberInput(`Speed mm/min for ${layer.name}`), '999999');
    expect(storedLayer('red').speed).toBe(useStore.getState().project.device.maxFeed);

    await typeAndBlur(numberInput(`Passes for ${layer.name}`), '2.7');
    expect(storedLayer('red').passes).toBe(2);

    const air = host.querySelector(`input[aria-label="Air assist for ${layer.name}"]`);
    if (!(air instanceof HTMLInputElement)) throw new Error('Air checkbox not found');
    await act(async () => air.click());
    expect(storedLayer('red').airAssist).toBe(true);
  });

  it('shows only output-enabled operations', async () => {
    const on = createLayer({ id: 'on', color: '#ff0000' });
    const off = { ...createLayer({ id: 'off', color: '#00ff00' }), output: false };
    seedLayers([on, off], 'laser');
    await render('laser');

    expect(host.querySelectorAll('input[aria-label^="Power % for"]')).toHaveLength(1);
  });

  it('commits CNC edits as a whole-object merge that preserves the other fields', async () => {
    const layer = createLayer({ id: 'red', color: '#ff0000' });
    seedLayers([layer], 'cnc');
    await render('cnc');

    await typeAndBlur(numberInput(`Feed mm/min for ${layer.name}`), '777');

    const cnc = storedLayer('red').cnc;
    expect(cnc?.feedMmPerMin).toBe(777);
    expect(cnc?.depthMm).toBe(1);
    expect(cnc?.cutType).toBe('profile-outside');
  });

  it('states plainly when nothing has Output enabled', async () => {
    const off = { ...createLayer({ id: 'off', color: '#00ff00' }), output: false };
    seedLayers([off], 'laser');
    await render('laser');

    expect(host.textContent).toContain('No operations have Output enabled');
  });

  it('shows the mode-specific detail line under a laser operation', async () => {
    seedLayers([createLayer({ id: 'red', color: '#ff0000' })], 'laser');
    await render('laser');

    expect(host.textContent).toContain('Artwork settings');
    expect(host.textContent).toContain('Kerf 0 mm · tabs off · min power 0%');
  });

  it('shows the strategy detail line under a CNC operation', async () => {
    seedLayers([createLayer({ id: 'red', color: '#ff0000' })], 'cnc');
    await render('cnc');

    expect(host.textContent).toContain('1 pass · stepover 40% · tabs off');
  });
});
