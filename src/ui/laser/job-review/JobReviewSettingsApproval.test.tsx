import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  EMPTY_SCENE,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { JobReviewSettingsApproval } from './JobReviewSettingsApproval';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

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

function approveButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Approve settings',
  );
  if (button === undefined) throw new Error('Approve settings button not found');
  return button;
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
});
