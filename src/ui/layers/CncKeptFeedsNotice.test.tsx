// CNC audit v1 F4-P2-1, driven through the real Artwork card and store: a bit
// change after a hand edit keeps the numbers (ADR-306, 2026-09-22 amendment),
// but the card now reads Manual and names what it kept.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncLayerSettings,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { materialFeedsPatch } from '../state/cnc-project-material';
import { resetStore, svgObj } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) =>
    state.project.scene.layers.find((entry) => entry.id === 'chosen'),
  );
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function renderFields(patch: Partial<CncLayerSettings>): Promise<void> {
  resetStore();
  const chosen: Layer = {
    ...createLayer({ id: 'chosen', color: '#123456' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-outside', depthMm: 6, ...patch },
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        layers: [chosen],
        objects: [{ ...svgObj('chosen-art', [chosen.color]), operationIds: [chosen.id] }],
      },
    },
    selectedObjectId: 'chosen-art',
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<ConnectedFields />));
}

function settings(): CncLayerSettings {
  const cnc = useStore.getState().project.scene.layers[0]?.cnc;
  if (cnc === undefined) throw new Error('CNC settings missing');
  return cnc;
}

function select(label: string): HTMLSelectElement {
  const element = host.querySelector<HTMLSelectElement>(
    `select[aria-label="${label} for #123456"]`,
  );
  if (element === null) throw new Error(`Missing ${label}`);
  return element;
}

function input(label: string): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>(`input[aria-label="${label} for #123456"]`);
  if (element === null) throw new Error(`Missing ${label}`);
  return element;
}

async function choose(label: string, value: string): Promise<void> {
  await act(async () => {
    const element = select(label);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Types into a box and lets its debounce commit, as an operator pausing does.
async function type(label: string, value: string): Promise<void> {
  await act(async () => {
    const element = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(350));
}

function notice(): HTMLElement | null {
  return host.querySelector<HTMLElement>('.lf-cnc-kept-feeds');
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((entry) => entry.textContent === text);
}

function recipeFor(toolId: string, spindleRpm: number): Partial<CncLayerSettings> {
  const tool = DEFAULT_CNC_MACHINE_CONFIG.tools.find((entry) => entry.id === toolId);
  if (tool === undefined) throw new Error(`Missing bit ${toolId}`);
  const patch = materialFeedsPatch({
    materialKey: 'hardwood',
    tool,
    spindleRpm,
    profile: useStore.getState().project.device,
    machineParams: DEFAULT_CNC_MACHINE_CONFIG.params,
  });
  if (patch === null) throw new Error('No hardwood recipe');
  return patch;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  resetStore();
  useToastStore.setState({ toasts: [] });
  vi.useRealTimers();
});

describe('a bit change that keeps hand-edited cutting values', () => {
  it('reads Manual after the edit, names the kept values, and re-applies the material for the new bit', async () => {
    vi.useFakeTimers();
    await renderFields({ toolId: 'em-6350' });
    await choose('Material', 'hardwood');
    expect(settings().feedSource).toMatchObject({ kind: 'material-recipe' });
    expect(select('Material').value).toBe('hardwood');

    // The refuter's sequence: hardwood on a 1/4" bit, then depth per pass 2.
    await type('Depth per pass', '2');
    expect(settings()).not.toHaveProperty('materialKey');
    expect(settings()).not.toHaveProperty('feedSource');
    expect(select('Material').value).toBe('');
    expect(
      host.querySelector('output[aria-label="Material for feeds calculator"]')?.textContent,
    ).toBe('Manual');
    const edited = settings();

    await choose('Bit', 'em-1588');
    // ADR-306: the operator's numbers stay exact.
    expect(settings()).toMatchObject({
      toolId: 'em-1588',
      feedMmPerMin: edited.feedMmPerMin,
      plungeMmPerMin: edited.plungeMmPerMin,
      spindleRpm: edited.spindleRpm,
      depthPerPassMm: 2,
    });
    const text = notice()?.textContent ?? '';
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(text).toContain(
      `Kept from the previous bit: feed ${edited.feedMmPerMin} mm/min, plunge ${edited.plungeMmPerMin} mm/min, spindle ${edited.spindleRpm.toLocaleString('en-US')} RPM, depth per pass 2 mm.`,
    );
    const recipe = recipeFor('em-1588', edited.spindleRpm);
    expect(recipe.feedMmPerMin).toBeLessThan(edited.feedMmPerMin);
    expect(recipe.depthPerPassMm).toBeLessThan(2);
    expect(text).toContain(
      `Hardwood (general) for this bit: feed ${recipe.feedMmPerMin} mm/min, plunge ${recipe.plungeMmPerMin} mm/min`,
    );
    expect(select('Material').value).toBe('');

    const undoDepth = useStore.getState().undoStack.length;
    await act(async () => button('Use Hardwood (general) values')?.click());
    expect(settings()).toMatchObject({ ...recipe, toolId: 'em-1588' });
    expect(select('Material').value).toBe('hardwood');
    expect(input('Feed').value).toBe(String(recipe.feedMmPerMin));
    expect(notice()).toBeNull();
    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
  });

  it('keeps the edited box mounted while the hand edit clears the material label', async () => {
    vi.useFakeTimers();
    await renderFields({ toolId: 'em-6350' });
    await choose('Material', 'hardwood');
    const feed = input('Feed');
    await type('Feed', '1800');
    expect(settings()).toMatchObject({ feedMmPerMin: 1800 });
    expect(settings()).not.toHaveProperty('materialKey');
    expect(input('Feed')).toBe(feed);
    expect(feed.value).toBe('1800');
  });

  it('asks for a material when the kept values follow none, and leaves once dismissed or edited', async () => {
    vi.useFakeTimers();
    await renderFields({ toolId: 'em-3175', feedMmPerMin: 731, depthPerPassMm: 0.7 });
    await choose('Bit', 'em-1588');
    expect(settings()).toMatchObject({ toolId: 'em-1588', feedMmPerMin: 731, depthPerPassMm: 0.7 });
    expect(notice()?.textContent).toContain(
      'Choose a Material above for starting values for this bit.',
    );
    expect(button('Use Hardwood (general) values')).toBeUndefined();
    await act(async () => button('Keep these values')?.click());
    expect(notice()).toBeNull();
    expect(settings()).toMatchObject({ toolId: 'em-1588', feedMmPerMin: 731 });

    await choose('Bit', 'em-6350');
    expect(notice()).not.toBeNull();
    await type('Feed', '900');
    expect(notice()).toBeNull();
  });

  it('says nothing when the material recipe follows the new bit', async () => {
    await renderFields({ toolId: 'em-6350' });
    await choose('Material', 'hardwood');
    await choose('Bit', 'em-1588');
    expect(settings()).toMatchObject({
      ...recipeFor('em-1588', settings().spindleRpm),
      toolId: 'em-1588',
    });
    expect(notice()).toBeNull();
    expect(select('Material').title).toContain('a new bit refreshes them');
    expect(select('Material').title).toContain('Editing one of those values sets this to Manual');
  });
});
