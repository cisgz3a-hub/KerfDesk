/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { ProjectBedReconciliationBanner } from './ProjectBedReconciliationBanner';

let host: HTMLDivElement;
let root: Root;

describe('ProjectBedReconciliationBanner', () => {
  beforeEach(() => {
    resetStore();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('discloses machine and bed changes with both nonblocking choices', async () => {
    const opened = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Opened machine',
      bedWidth: 400,
      bedHeight: 300,
    });
    useStore.getState().setProject({
      ...opened,
      workspace: { ...opened.workspace, width: 250, height: 200 },
    });

    await act(async () => root.render(<ProjectBedReconciliationBanner />));

    expect(host.textContent).toContain('Opened project machine');
    expect(host.textContent).toContain('250 × 200 mm');
    expect(host.textContent).toContain('400 × 300 mm');
    expect(host.textContent).toContain('Use project machine');
    expect(host.textContent).toContain('Keep current machine');
  });
});
