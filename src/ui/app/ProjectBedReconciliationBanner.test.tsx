/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
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

  it.each(['Use project machine', 'Keep current machine'])(
    '%s retains the chosen profile and clears the disclosure',
    async (label) => {
      const previous = {
        ...createProject({
          ...DEFAULT_DEVICE_PROFILE,
          name: 'Current router',
          bedWidth: 500,
          bedHeight: 450,
        }),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      };
      useStore.setState({ project: previous });
      const opened = createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Opened laser',
        bedWidth: 400,
        bedHeight: 300,
      });
      useStore.getState().setProject(opened);
      const scene = useStore.getState().project.scene;
      await act(async () => root.render(<ProjectBedReconciliationBanner />));
      const button = [...host.querySelectorAll('button')].find(
        (item) => item.textContent === label,
      );
      if (button === undefined) throw new Error('Missing reconciliation choice');
      await act(async () => button.click());
      const state = useStore.getState();
      const retained = label === 'Keep current machine' ? previous : opened;
      expect(state.project.device).toEqual(retained.device);
      expect(state.project.machine).toEqual(retained.machine);
      expect(state.project.workspace).toMatchObject({
        width: retained.device.bedWidth,
        height: retained.device.bedHeight,
      });
      expect(state.project.scene).toBe(scene);
      expect(state.projectBedReconciliation).toBeNull();
      expect(host.textContent).toBe('');
    },
  );
});
