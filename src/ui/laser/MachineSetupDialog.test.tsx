import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useLaserStore } from '../state/laser-store';
import { MachineSetupDialog } from './MachineSetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    statusReport: null,
    wcoCache: null,
    workOriginActive: false,
    transcript: [],
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('MachineSetupDialog', () => {
  it('reviews and applies the diagnostic profile suggestion to the local profile', async () => {
    useLaserStore.setState({
      controllerSettings: {
        maxPowerS: 750,
        laserModeEnabled: true,
        bedWidth: 400,
        bedHeight: 400,
        homingEnabled: true,
      },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      transcript: [
        {
          id: 1,
          at: 1,
          direction: 'in',
          raw: '[VER:1.1h.20231001:]',
          kind: 'message',
          source: 'controller',
        },
      ],
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderDialog();
    try {
      await act(async () => {
        button(host, 'Overview').click();
      });

      expect(host.textContent).toContain('Diagnostic profile suggestion');
      expect(host.textContent).toContain('Controller $30 is 750');
      expect(host.textContent).toContain('Max power (S)');

      await act(async () => {
        button(host, 'Apply local profile suggestion').click();
      });

      expect(useStore.getState().project.device.maxPowerS).toBe(750);
    } finally {
      await cleanup();
    }
  });

  it('keeps firmware setup isolated on its own tab', async () => {
    const { host, cleanup } = await renderDialog();
    try {
      expect(host.textContent).not.toContain('Apply one-time GRBL setup');

      await act(async () => button(host, 'Firmware Writes').click());

      expect(host.textContent).toContain('Apply one-time GRBL setup');
    } finally {
      await cleanup();
    }
  });

  it('generates a scan-offset test scene from the calibration tab', async () => {
    const { host, cleanup } = await renderDialog();
    try {
      await act(async () => button(host, 'Calibration').click());
      expect(host.textContent).toContain('Raster calibration');

      await act(async () => button(host, 'Generate scan offset test').click());

      const scene = useStore.getState().project.scene;
      expect(scene.objects).toHaveLength(3);
      expect(scene.layers).toHaveLength(3);
      expect(scene.layers.map((layer) => layer.speed)).toEqual([600, 1200, 1800]);
      expect(scene.layers.every((layer) => layer.mode === 'fill')).toBe(true);
      expect(scene.layers.every((layer) => layer.fillBidirectional)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('stores measured bidirectional scan offset on the active profile', async () => {
    const { host, cleanup } = await renderDialog();
    try {
      await act(async () => button(host, 'Calibration').click());

      input(host, 'Calibration speed').value = '900';
      input(host, 'Measured line separation').value = '0.6';
      input(host, 'Initial X offset').value = '0.1';

      await act(async () => button(host, 'Save scan offset').click());

      expect(useStore.getState().project.device.rasterCalibration).toMatchObject({
        enabled: true,
        source: 'calibration-test',
        initialXOffsetMm: 0.1,
        bidirectionalOffsetPoints: [{ speedMmPerMin: 900, offsetMm: 0.3 }],
      });
    } finally {
      await cleanup();
    }
  });
});

async function renderDialog(): Promise<{
  readonly host: HTMLElement;
  readonly cleanup: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={platform}>
        <MachineSetupDialog onClose={vi.fn()} setupDisabled={false} />
      </PlatformProvider>,
    );
  });
  return {
    host,
    cleanup: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const match = host.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`Input not rendered: ${label}`);
  return match;
}
