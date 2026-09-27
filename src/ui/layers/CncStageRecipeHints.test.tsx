import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Layer,
  type ReliefObject,
} from '../../core/scene';
import type { CncCuttingStage } from '../../core/scene/cnc-stage-recipe';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const COLOR = '#123456';
const RECIPE = {
  toolId: 'em-6350',
  feedMmPerMin: 321,
  plungeMmPerMin: 123,
  spindleRpm: 8000,
  depthPerPassMm: 0.75,
};

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function install(settings: Partial<CncLayerSettings>, withRelief = false): Promise<void> {
  const layer: Layer = {
    ...createLayer({ id: 'recipe-layer', color: COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-1588', ...settings },
  };
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'relief',
    source: 'fixture.stl',
    targetWidthMm: 10,
    reliefDepthMm: 2,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
      emptyCells: 'floor',
    },
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { layers: [layer], objects: withRelief ? [relief] : [] },
    },
  });
  await act(async () => root.render(<ConnectedFields />));
}

function required<T extends HTMLElement>(selector: string): T {
  const node = host.querySelector<T>(selector);
  if (node === null) throw new Error(`Missing ${selector}`);
  return node;
}

async function choose(label: string, value: string): Promise<void> {
  const select = required<HTMLSelectElement>(`select[aria-label="${label} for ${COLOR}"]`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function hint(label: string): string | null | undefined {
  return required(`select[aria-label="${label} for ${COLOR}"]`)
    .closest('.lf-cnc-tool-field')
    ?.querySelector('[role="note"]')?.textContent;
}

const STAGES: readonly {
  stage: CncCuttingStage;
  label: string;
  feedLabel: string;
  settings: Partial<CncLayerSettings>;
  relief?: boolean;
}[] = [
  {
    stage: 'pocket-rough',
    label: 'Pocket roughing bit',
    feedLabel: 'Pocket roughing feed',
    settings: { cutType: 'pocket', pocketRoughToolId: RECIPE.toolId },
  },
  {
    stage: 'v-clear',
    label: 'Clearing bit',
    feedLabel: 'V-carve clearing feed',
    settings: {
      cutType: 'v-carve',
      vCarveFlatDepthEnabled: true,
      vClearToolId: RECIPE.toolId,
    },
  },
  {
    stage: 'relief-finish',
    label: 'Relief finishing bit',
    feedLabel: 'Relief finishing feed',
    settings: { cutType: 'engrave', reliefFinishToolId: RECIPE.toolId },
    relief: true,
  },
];

describe('CNC compact settings preserve independent stage recipes', () => {
  it.each(STAGES)(
    'explains the effective $stage recipe and retains it across material and bit changes',
    async (fixture) => {
      await install(
        { ...fixture.settings, stageRecipes: { [fixture.stage]: RECIPE } },
        fixture.relief,
      );
      expect(hint(fixture.label)).toContain('Uses separate');
      expect(hint(fixture.label)).toContain('Stage cutting values');
      const input = `input[aria-label="${fixture.feedLabel} for ${COLOR}"]`;
      expect(required<HTMLInputElement>(input).value).toBe('321');

      await choose('Material', 'hardwood-birch');
      expect(
        useStore.getState().project.scene.layers[0]?.cnc?.stageRecipes?.[fixture.stage],
      ).toEqual(RECIPE);
      expect(required<HTMLInputElement>(input).value).toBe('321');

      await choose(fixture.label, 'em-3175');
      expect(hint(fixture.label)).toContain("Uses the primary bit's");
      expect(host.querySelector(input)).toBeNull();
      expect(host.textContent).toContain('Saved values belong to a different cutter');
      expect(
        useStore.getState().project.scene.layers[0]?.cnc?.stageRecipes?.[fixture.stage],
      ).toEqual(RECIPE);

      await choose(fixture.label, RECIPE.toolId);
      expect(hint(fixture.label)).toContain('Uses separate');
      expect(required<HTMLInputElement>(input).value).toBe('321');
    },
  );

  it('describes the wall finish depth ladder instead of promising a full-depth pass', async () => {
    await install({
      cutType: 'profile-outside',
      toolId: RECIPE.toolId,
      depthMm: 3,
      finishAllowanceMm: 0.2,
      stageRecipes: { 'profile-finish': RECIPE },
    });
    const summary = [...host.querySelectorAll('summary')].find((node) =>
      node.textContent?.startsWith('Wall finish'),
    );
    expect(summary?.title).toContain('separate wall finishing values');
    expect(summary?.title).not.toContain('one full-depth pass');
    expect(
      required<HTMLInputElement>(`input[aria-label="Wall finishing depth per pass for ${COLOR}"]`)
        .value,
    ).toBe('0.75');
    await choose('Bit', 'em-3175');
    expect(summary?.title).toContain('one full-depth pass');
    expect(
      useStore.getState().project.scene.layers[0]?.cnc?.stageRecipes?.['profile-finish'],
    ).toEqual(RECIPE);
  });

  it('names circular entry in the closed summary after the real control enables it', async () => {
    await install({ cutType: 'pocket', rampEntryDeg: 2 });
    const summary = [...host.querySelectorAll('summary')].find((node) =>
      node.textContent?.startsWith('Entry & travel'),
    );
    expect(summary?.textContent).toContain('Ramp 2°');
    await act(async () =>
      required<HTMLInputElement>(`input[aria-label="Helical entry for ${COLOR}"]`).click(),
    );
    expect(useStore.getState().project.scene.layers[0]?.cnc?.helixEntry).toBeDefined();
    expect(summary?.textContent).toContain('Circular ramp');
    expect(summary?.textContent).not.toContain('Plunge');
  });
});
