import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  EMPTY_SCENE,
  type Layer,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JobReviewSettingsApproval } from './JobReviewSettingsApproval';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

const PROPERTY_RUNS = 30;
const MAX_PROPERTY_SETTINGS = 8;
const MAX_POWER_PERCENT = 100;
const MAX_FEED_MM_PER_MIN = 6_000;

type ApprovalSettings = {
  readonly power: number;
  readonly airAssist: boolean;
  readonly cncFeedMmPerMin: number;
  readonly subLayerPower: number;
};

const approvalSettingsArbitrary: fc.Arbitrary<ApprovalSettings> = fc.record({
  power: fc.integer({ min: 0, max: MAX_POWER_PERCENT }),
  airAssist: fc.boolean(),
  cncFeedMmPerMin: fc.integer({ min: 1, max: MAX_FEED_MM_PER_MIN }),
  subLayerPower: fc.integer({ min: 0, max: MAX_POWER_PERCENT }),
});

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  resetStore();
});

async function render(onApprove: () => void): Promise<void> {
  root = createRoot(host);
  await act(async () => root?.render(<JobReviewSettingsApproval onApprove={onApprove} />));
}

async function unmount(): Promise<void> {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
}

function approveButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Approve settings',
  );
  if (button === undefined) throw new Error('Approve settings button not found');
  return button;
}

function layerWithApprovalSettings(settings: ApprovalSettings): Layer {
  const base = createLayer({ id: 'red', color: '#ff0000' });
  const subLayer = createLayerSubLayer(base, {
    id: 'detail',
    label: 'Detail',
    settings: { ...base, power: settings.subLayerPower },
  });
  return {
    ...base,
    power: settings.power,
    airAssist: settings.airAssist,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: settings.cncFeedMmPerMin },
    subLayers: [subLayer],
  };
}

async function setApprovalSettings(settings: ApprovalSettings): Promise<void> {
  await act(async () =>
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, layers: [layerWithApprovalSettings(settings)] },
      },
    })),
  );
}

function approvalSettingsKey(settings: ApprovalSettings): string {
  return JSON.stringify(settings);
}

type ApprovalSequenceState = {
  approvedKey: string;
  expectedRebuilds: number;
};

async function exerciseApprovalSettingsCase(
  settings: ApprovalSettings,
  state: ApprovalSequenceState,
  onApprove: Mock,
): Promise<void> {
  await setApprovalSettings(settings);
  const nextKey = approvalSettingsKey(settings);
  const changed = nextKey !== state.approvedKey;
  expect(host.textContent).toContain(
    changed
      ? 'Changes are synced to the main Artwork / Operations'
      : state.expectedRebuilds === 0
        ? 'Main Artwork / Operations settings match this review.'
        : 'Approved — current values are synced',
  );

  await act(async () => approveButton().click());
  if (changed) state.expectedRebuilds += 1;
  state.approvedKey = nextKey;
  expect(onApprove).toHaveBeenCalledTimes(state.expectedRebuilds);
  expect(host.textContent).toContain('Approved — current values are synced');

  await setApprovalSettings(settings);
  await act(async () => approveButton().click());
  expect(onApprove).toHaveBeenCalledTimes(state.expectedRebuilds);
}

async function exerciseApprovalSettingsSequence(
  settingsCases: readonly ApprovalSettings[],
): Promise<void> {
  await unmount();
  const initial = settingsCases[0];
  if (initial === undefined) throw new Error('Property generated no settings.');
  await setApprovalSettings(initial);
  const onApprove = vi.fn();
  await render(onApprove);
  const state: ApprovalSequenceState = {
    approvedKey: approvalSettingsKey(initial),
    expectedRebuilds: 0,
  };

  for (const settings of settingsCases) {
    await exerciseApprovalSettingsCase(settings, state, onApprove);
  }
}

describe('JobReviewSettingsApproval', () => {
  it('approves live-synced main settings and re-arms after another edit', async () => {
    const onApprove = vi.fn();
    await render(onApprove);

    expect(approveButton().disabled).toBe(false);
    expect(host.textContent).toContain('Main Artwork / Operations settings match this review.');

    await act(async () => approveButton().click());
    expect(onApprove).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Approved — current values are synced');

    await act(async () => useStore.getState().setLayerParam('red', { power: 55 }));

    expect(useStore.getState().project.scene.layers[0]?.power).toBe(55);
    expect(approveButton().disabled).toBe(false);
    expect(host.textContent).toContain('Changes are synced to the main Artwork / Operations');

    await act(async () => approveButton().click());

    expect(approveButton().disabled).toBe(false);
    expect(host.textContent).toContain(
      'Approved — current values are synced to the main Artwork / Operations settings.',
    );
    expect(onApprove).toHaveBeenCalledTimes(1);

    await act(async () => useStore.getState().setLayerParam('red', { power: 60 }));

    expect(approveButton().disabled).toBe(false);
    expect(host.textContent).toContain('Changes are synced to the main Artwork / Operations');
  });

  it('detects and approves CNC operation settings from the same main store', async () => {
    const onApprove = vi.fn();
    await render(onApprove);

    await act(async () =>
      useStore.getState().setLayerParam('red', {
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 777 },
      }),
    );

    expect(host.textContent).toContain('Changes are synced to the main Artwork / Operations');
    await act(async () => approveButton().click());
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Approved — current values are synced');
  });

  it('preserves changed and unchanged approval invariants across generated settings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(approvalSettingsArbitrary, { minLength: 1, maxLength: MAX_PROPERTY_SETTINGS }),
        exerciseApprovalSettingsSequence,
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
