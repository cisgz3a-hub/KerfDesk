import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};
const idleStatus = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 12, y: 34, z: 5 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.getState().setRailPanelVisible('machine', true);
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    alarmCode: null,
    resetRequired: false,
    airAssistOn: false,
  });
});

describe('LaserWindow anchored controls', () => {
  it('keeps laser jog, focus, manual air and coordinates together above persistent tools', async () => {
    useStore.setState({
      project: createProject({
        ...DEFAULT_DEVICE_PROFILE,
        capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'z-axis'],
        zTravelConfirmed: true,
        zTravelMm: 20,
      }),
    });
    useLaserStore.setState({ connection: { kind: 'connected' }, statusReport: idleStatus });
    const view = await renderRail();
    try {
      const primary = requiredRegion(view.host, 'Jog and machine status');
      const tools = requiredRegion(view.host, 'Machine tools');
      const jog = primary.querySelector('.lf-jog-panel');
      const focus = focusButton(primary);
      expect(focus).toBeInstanceOf(HTMLButtonElement);
      expect(primary.textContent).toContain('Manual Air');
      expect(primary.textContent).toContain('MPos: X 12.000 Y 34.000 Z 5.000');
      expect(primary.textContent).not.toContain('Move to position');
      expect(tools.querySelector('.lf-jog-panel')).toBeNull();
      expect(view.host.querySelector('.lf-connection-card')).toBeNull();
      expect(view.host.querySelector('select[aria-label="Laser module"]')).toBeNull();

      const consoleSection = [...tools.querySelectorAll('details')].find(
        (section) => section.querySelector('summary')?.textContent === 'Console',
      );
      if (consoleSection === undefined) throw new Error('Console disclosure missing');
      await act(async () => {
        consoleSection.open = true;
        consoleSection.dispatchEvent(new Event('toggle'));
        tools.scrollTop = 1000;
        tools.dispatchEvent(new Event('scroll'));
        useLaserStore.setState({
          statusReport: { ...idleStatus, mPos: { x: 13, y: 34, z: 5 } },
        });
      });

      expect(primary.querySelector('.lf-jog-panel')).toBe(jog);
      expect(focusButton(primary)).toBe(focus);
      expect(primary.textContent).toContain('MPos: X 13.000 Y 34.000 Z 5.000');
      expect(consoleSection.open).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('keeps CNC Z controls in the jog group and probe/maintenance in the tools scroller', async () => {
    useStore.setState({
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    const view = await renderRail();
    try {
      const primary = requiredRegion(view.host, 'Jog and machine status');
      const tools = requiredRegion(view.host, 'Machine tools');
      expect(
        primary.querySelector('button[aria-label="Zero work Z at current bit height"]'),
      ).toBeInstanceOf(HTMLButtonElement);
      expect(primary.textContent).not.toContain('Probe (touch plate)');
      expect(tools.textContent).toContain('Probe (touch plate)');
      expect(tools.textContent).toContain('Homing & maintenance');
      expect(tools.textContent).toContain('Machine hours');
      expect(primary.textContent).not.toContain('Manual Air');
    } finally {
      await view.unmount();
    }
  });

  it('keeps sleep and alarm recovery in the top group as controller reports change', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: { ...idleStatus, state: 'Sleep' },
    });
    const view = await renderRail();
    try {
      const primary = requiredRegion(view.host, 'Jog and machine status');
      expect(primary.textContent).toContain('Controller is asleep');
      expect(primary.textContent).toContain('Wake (Ctrl-X)');
      await act(async () => {
        useLaserStore.setState({
          statusReport: { ...idleStatus, state: 'Alarm' },
          alarmCode: 1,
          resetRequired: true,
        });
      });
      expect(primary.textContent).not.toContain('Controller is asleep');
      expect(primary.textContent).toContain('Reset (Ctrl-X)');
      const step = primary.querySelector<HTMLSelectElement>('[aria-label="Jog step size"]');
      expect(step?.disabled).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});

function requiredRegion(host: HTMLElement, label: string): HTMLElement {
  const region = host.querySelector(`section[aria-label="${label}"]`);
  if (!(region instanceof HTMLElement)) throw new Error(`Missing region: ${label}`);
  return region;
}

function focusButton(host: HTMLElement): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === 'Jog Z+ 1 mm',
  );
}

async function renderRail(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <LaserWindow dockedJobActions />
      </PlatformProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}
