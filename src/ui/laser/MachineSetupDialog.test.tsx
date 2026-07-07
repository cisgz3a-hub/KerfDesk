import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { FileOpenRequest, FileSaveRequest, PlatformAdapter } from '../../platform/types';
import {
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  serializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
} from '../../io/machine-profile';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { MachineSetupDialog } from './MachineSetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function platformWithFiles(
  files: ReadonlyArray<{ readonly name: string; readonly text: string }>,
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: vi.fn(async (_request: FileOpenRequest) =>
      files.map((file) => ({ name: file.name, text: async () => file.text })),
    ),
    pickFileForSave: vi.fn(async (_request: FileSaveRequest) => ({
      displayName: 'active.lfmachine.json',
      write: vi.fn(async () => undefined),
    })),
    serial: { isSupported: () => true, requestPort: async () => null },
  };
}

async function renderDialog(
  platform: PlatformAdapter = platformWithFiles([]),
  onRunGuidedSetup?: () => void,
): Promise<{
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
        <MachineSetupDialog
          onClose={() => undefined}
          {...(onRunGuidedSetup === undefined ? {} : { onRunGuidedSetup })}
        />
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

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('MachineSetupDialog', () => {
  it('presents Machine Setup tabs and applies a built-in catalog profile', async () => {
    const { host, unmount } = await renderDialog();
    try {
      for (const label of [
        'Overview',
        'Profile Catalog',
        'Controller Settings',
        'Firmware Writes',
        'Safety Zones',
        'Raster Diagnostics',
        'Import / Export',
      ]) {
        expect(button(host, label)).toBeInstanceOf(HTMLButtonElement);
      }
      expect(host.textContent).not.toContain('Camera');

      await act(async () => button(host, 'Profile Catalog').click());
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());

      expect(useStore.getState().project.device.profileId).toBe(
        'creality-falcon-a1-pro-compatible',
      );
      expect(useStore.getState().dirty).toBe(true);
    } finally {
      await unmount();
    }
  });

  it('keeps controller-tuned motion settings when applying a catalog profile after auto-detect', async () => {
    useStore.getState().updateDeviceProfile({
      maxFeed: 10000,
      framingFeedMmPerMin: 10000,
      accelMmPerSec2: 2500,
      junctionDeviationMm: 0.01,
      bedWidth: 400,
      bedHeight: 400,
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      detectedControllerKind: 'grblhal',
      controllerSettings: {
        maxFeed: 10000,
        accelMmPerSec2: 2500,
        junctionDeviationMm: 0.01,
        bedWidth: 400,
        bedHeight: 400,
      },
      lastSettingsReadAt: 1718600000000,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderDialog();
    try {
      await act(async () => button(host, 'Profile Catalog').click());
      await act(async () => button(host, 'Use Creality Falcon A1 Pro').click());

      expect(useStore.getState().project.device).toMatchObject({
        profileId: 'creality-falcon-a1-pro-compatible',
        controllerKind: 'grblhal',
        maxFeed: 10000,
        framingFeedMmPerMin: 10000,
        accelMmPerSec2: 2500,
      });
    } finally {
      await unmount();
    }
  });

  it('offers the guided setup cross-link on Overview only when a launcher is wired', async () => {
    const withoutLauncher = await renderDialog();
    try {
      expect(withoutLauncher.host.textContent).not.toContain('Run guided setup');
    } finally {
      await withoutLauncher.unmount();
    }

    const onRunGuidedSetup = vi.fn();
    const { host, unmount } = await renderDialog(platformWithFiles([]), onRunGuidedSetup);
    try {
      await act(async () => button(host, 'Run guided setup').click());
      expect(onRunGuidedSetup).toHaveBeenCalledTimes(1);
      // The cross-link belongs to Overview only — other tabs stay uncluttered.
      await act(async () => button(host, 'Safety Zones').click());
      expect(host.textContent).not.toContain('Run guided setup');
    } finally {
      await unmount();
    }
  });

  it('exposes explicit help metadata on every Machine Setup tab', async () => {
    const expected = [
      ['Overview', 'control:laser.machine-setup.tab.overview'],
      ['Profile Catalog', 'control:laser.machine-setup.tab.catalog'],
      ['Controller Settings', 'control:laser.machine-setup.tab.controller'],
      ['Firmware Writes', 'control:laser.machine-setup.tab.firmware'],
      ['Safety Zones', 'control:laser.machine-setup.tab.zones'],
      ['Raster Diagnostics', 'control:laser.machine-setup.tab.raster-diagnostics'],
      ['Import / Export', 'control:laser.machine-setup.tab.import-export'],
    ] as const;
    const { host, unmount } = await renderDialog();
    try {
      for (const [label, helpId] of expected) {
        const tab = button(host, label);

        expect(tab.dataset.helpId).toBe(helpId);
        expect(tab.title.length).toBeGreaterThan(30);
      }
    } finally {
      await unmount();
    }
  });

  it('summarizes raster calibration risks for bidirectional output', async () => {
    useStore.getState().setProject(
      projectWithLayers([
        {
          ...createLayer({ id: 'image-layer', color: '#111111', mode: 'image' }),
          imageBidirectional: true,
          linesPerMm: 12,
          fillOverscanMm: 0,
        },
        {
          ...createLayer({ id: 'fill-layer', color: '#222222', mode: 'fill' }),
          fillBidirectional: true,
          fillOverscanMm: 0,
        },
      ]),
    );
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(
        new Map<number, string>([
          [30, '1000'],
          [32, '0'],
        ]),
      ),
      lastSettingsReadAt: 1718600000000,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    const { host, unmount } = await renderDialog();
    try {
      await act(async () => button(host, 'Raster Diagnostics').click());

      expect(host.textContent).toContain('No scan-offset calibration');
      expect(host.textContent).toContain('Bidirectional image layers: 1');
      expect(host.textContent).toContain('Bidirectional fill layers: 1');
      expect(host.textContent).toContain('$32 Laser mode: 0');
      expect(host.textContent).toContain('Laser mode is off');
      expect(host.textContent).toContain('Low overscan layers: 2');
      expect(host.textContent).toContain('Default recipe layers: 2');
      expect(host.textContent).toContain('Default line intervals: 1');
      expect(host.textContent).toContain('Run Material Test on scrap before production.');
      expect(host.textContent).toContain('Run Interval Test on the same material');
    } finally {
      await unmount();
    }
  });

  it('surfaces Island Fill short-sweep heat risk in raster diagnostics', async () => {
    const islandLayer = {
      ...createLayer({ id: 'island-layer', color: '#ff0000', mode: 'fill' }),
      fillStyle: 'island' as const,
      fillOverscanMm: 5,
      hatchSpacingMm: 1,
    };
    useStore.getState().setProject({
      ...projectWithLayers([islandLayer]),
      scene: {
        ...EMPTY_SCENE,
        layers: [islandLayer],
        objects: [tinyIslandObject()],
      },
    });

    const { host, unmount } = await renderDialog();
    try {
      await act(async () => button(host, 'Raster Diagnostics').click());

      expect(host.textContent).toContain('Island Fill has 3 short sweep(s)');
      expect(host.textContent).toContain('partial acceleration runway');
    } finally {
      await unmount();
    }
  });

  it('imports a KerfDesk machine profile through a review step', async () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: { ...DEFAULT_DEVICE_PROFILE, name: 'Imported bench profile', bedWidth: 500 },
      source: { kind: 'custom', label: 'Fixture' },
      reviewNotes: ['Fixture import.'],
    });
    const { host, unmount } = await renderDialog(
      platformWithFiles([{ name: 'bench.lfmachine.json', text }]),
    );
    try {
      await act(async () => button(host, 'Import / Export').click());
      await act(async () => button(host, 'Import KerfDesk profile').click());

      expect(host.textContent).toContain('Imported bench profile');
      expect(host.textContent).toContain('Fixture import.');

      await act(async () => button(host, 'Apply imported profile').click());

      expect(useStore.getState().project.device.name).toBe('Imported bench profile');
      expect(useStore.getState().project.workspace.width).toBe(500);
    } finally {
      await unmount();
    }
  });

  it('imports LightBurn lbdev files as review-first profiles', async () => {
    const lbdev =
      '<LightBurnDevice><Name>LB 4040</Name><Controller>GRBL</Controller><Width>410</Width><Height>390</Height><SMax>1000</SMax></LightBurnDevice>';
    const { host, unmount } = await renderDialog(
      platformWithFiles([{ name: 'lb.lbdev', text: lbdev }]),
    );
    try {
      await act(async () => button(host, 'Import / Export').click());
      await act(async () => button(host, 'Import LightBurn .lbdev').click());

      expect(host.textContent).toContain('Imported device review');
      expect(host.textContent).toContain('LB 4040');

      await act(async () => button(host, 'Apply imported profile').click());

      expect(useStore.getState().project.device.profileSource).toBe('lightburn');
      expect(useStore.getState().project.device.bedWidth).toBe(410);
    } finally {
      await unmount();
    }
  });

  it('guards one-setting firmware writes behind an explicit checkbox', async () => {
    const originalWrite = useLaserStore.getState().writeGrblSetting;
    const writeGrblSetting = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      grblSettingsRows: settingsMapToRows(
        new Map<number, string>([
          [30, '900'],
          [999, 'custom'],
        ]),
      ),
      lastSettingsReadAt: Date.now(),
      writeGrblSetting,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderDialog();
    try {
      await act(async () => button(host, 'Firmware Writes').click());

      expect(host.textContent).toContain('$30');
      expect(host.textContent).not.toContain('$999');
      const write = button(host, 'Write $30');
      expect(write.disabled).toBe(true);

      const value = host.querySelector('input[aria-label="New value for $30"]');
      const confirm = host.querySelector('input[aria-label="Confirm write $30"]');
      if (!(value instanceof HTMLInputElement)) throw new Error('value input missing');
      if (!(confirm instanceof HTMLInputElement)) throw new Error('confirm input missing');

      await act(async () => {
        value.value = '1000';
        Simulate.change(value);
      });
      await act(async () => {
        confirm.checked = true;
        Simulate.change(confirm);
      });
      expect(write.disabled).toBe(false);

      await act(async () => {
        write.click();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(writeGrblSetting).toHaveBeenCalledWith(30, '1000');
    } finally {
      await unmount();
      await act(async () => {
        useLaserStore.setState({ writeGrblSetting: originalWrite });
      });
    }
  });
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function projectWithLayers(layers: ReadonlyArray<Layer>): Project {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Neotronics 4040 Max LT-4LDS-V2 20W',
      profileId: 'neotronics-4040-max-lt4lds-v2-20w',
      scanningOffsets: [],
    }),
    scene: { ...EMPTY_SCENE, layers },
  };
}

function tinyIslandObject(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'tiny-island',
    source: 'tiny-island.svg',
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 3, y: 0 },
              { x: 3, y: 3 },
              { x: 0, y: 3 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}
