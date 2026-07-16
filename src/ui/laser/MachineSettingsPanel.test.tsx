import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { MachineSettingsPanel } from './MachineSettingsPanel';
import type { MachineSettingsPresentationContext } from './machine-settings-presentation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function makePlatform(
  save: PlatformAdapter['pickFileForSave'] = async () => null,
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => true,
      requestPort: async () => null,
    },
  };
}

afterEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    safetyNotice: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('MachineSettingsPanel', () => {
  it('renders collapsed by default', async () => {
    const { host, cleanup } = await renderPanel();
    try {
      expect(detailsBySummary(host, 'Read / Backup Controller Settings').open).toBe(false);
      expect(host.textContent).toContain('Reads live controller settings with $$');
    } finally {
      await cleanup();
    }
  });

  it('disables read while disconnected', async () => {
    const { host, cleanup } = await renderPanel();
    try {
      const read = button(host, 'Read ($$)');
      expect(read.disabled).toBe(true);
      expect(read.title).toMatch(/connect/i);
    } finally {
      await cleanup();
    }
  });

  it('calls readMachineSettings when Read is clicked', async () => {
    const original = useLaserStore.getState().readMachineSettings;
    const readMachineSettings = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      readMachineSettings,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel();
    try {
      await act(async () => {
        button(host, 'Read ($$)').click();
        await Promise.resolve();
      });

      expect(readMachineSettings).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        useLaserStore.setState({ readMachineSettings: original });
      });
      await cleanup();
    }
  });

  it('renders known and unknown settings rows', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(
        new Map<number, string>([
          [30, '1000'],
          [999, 'custom'],
        ]),
      ),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel();
    try {
      expect(host.textContent).toContain('$30');
      expect(host.textContent).toContain('Laser S maximum');
      expect(host.textContent).not.toMatch(/spindle|CNC|RPM/i);
      expect(host.textContent).toContain('$999');
      expect(host.textContent).toContain('Unknown GRBL setting');
    } finally {
      await cleanup();
    }
  });

  it('groups settings by category and filters by search text', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(
        new Map<number, string>([
          [30, '1000'],
          [100, '80'],
          [999, 'custom'],
        ]),
      ),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel();
    try {
      expect(host.textContent).toContain('Laser output');
      expect(host.textContent).toContain('Motion');
      expect(host.textContent).toContain('Unknown');

      const search = host.querySelector('input[aria-label="Search controller settings"]');
      if (!(search instanceof HTMLInputElement)) throw new Error('Search input missing');
      await act(async () => {
        search.value = 'laser';
        Simulate.change(search);
      });

      expect(host.textContent).toContain('$30');
      expect(host.textContent).not.toContain('$100');
      expect(host.textContent).not.toContain('$999');
    } finally {
      await cleanup();
    }
  });

  it('uses CNC-only labels and does not leak laser terms into search', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(
        new Map<number, string>([
          [30, '12000'],
          [31, '1000'],
          [32, '0'],
        ]),
      ),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel(makePlatform(), CNC_CONTEXT);
    try {
      expect(host.textContent).toContain('CNC spindle output');
      expect(host.textContent).toContain('Maximum spindle speed');
      expect(host.textContent).toContain('RPM');
      expect(host.textContent).not.toMatch(/laser/i);

      const search = host.querySelector('input[aria-label="Search controller settings"]');
      if (!(search instanceof HTMLInputElement)) throw new Error('Search input missing');
      await act(async () => {
        search.value = 'laser';
        Simulate.change(search);
      });
      expect(host.textContent).toContain('No settings match.');
    } finally {
      await cleanup();
    }
  });

  it('shows both contracts and the active mode for a hybrid profile', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel(makePlatform(), HYBRID_CONTEXT);
    try {
      expect(host.textContent).toContain('Laser + CNC output (Laser active)');
      expect(host.textContent).toContain('Laser S maximum / spindle maximum');
      expect(host.textContent).toContain('switching workspace mode does not write');
    } finally {
      await cleanup();
    }
  });

  it('uses combined labels when the saved profile capability is unspecified', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel(makePlatform(), null);
    try {
      expect(host.textContent).toContain('Laser + CNC output (capability not set)');
      expect(host.textContent).toContain('Laser S maximum / spindle maximum');
    } finally {
      await cleanup();
    }
  });

  it('disables export until settings exist', async () => {
    const { host, cleanup } = await renderPanel();
    try {
      const exportButton = button(host, 'Export backup');
      expect(exportButton.disabled).toBe(true);
      expect(exportButton.title).toMatch(/read machine settings/i);
    } finally {
      await cleanup();
    }
  });

  it('exports visible settings through PlatformAdapter', async () => {
    let written = '';
    const target: SaveTarget = {
      displayName: 'settings.lfgrbl-settings.json',
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('expected text backup');
        written = data;
      },
    };
    const platform = makePlatform(async () => target);
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
      lastSettingsReadAt: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel(platform);
    try {
      await act(async () => {
        button(host, 'Export backup').click();
        await Promise.resolve();
      });

      expect(JSON.parse(written).settings).toEqual([
        expect.objectContaining({
          code: '$30',
          rawValue: '1000',
          name: 'Max spindle speed / laser S max',
          category: 'laser',
        }),
      ]);
    } finally {
      await cleanup();
    }
  });

  it('does not render any firmware write controls', async () => {
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, cleanup } = await renderPanel();
    try {
      expect(host.textContent).not.toMatch(/\bWrite\b/);
      expect(host.textContent).not.toMatch(/\bLoad\b/);
    } finally {
      await cleanup();
    }
  });
});

const LASER_CONTEXT: MachineSettingsPresentationContext = {
  machineKinds: ['laser'],
  activeMachineKind: 'laser',
};
const CNC_CONTEXT: MachineSettingsPresentationContext = {
  machineKinds: ['cnc'],
  activeMachineKind: 'cnc',
};
const HYBRID_CONTEXT: MachineSettingsPresentationContext = {
  machineKinds: ['laser', 'cnc'],
  activeMachineKind: 'laser',
};

async function renderPanel(
  platform = makePlatform(),
  context: MachineSettingsPresentationContext | null = LASER_CONTEXT,
): Promise<{
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
        {context === null ? <MachineSettingsPanel /> : <MachineSettingsPanel context={context} />}
      </PlatformProvider>,
    );
  });
  return {
    host,
    cleanup: async () => {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
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

function detailsBySummary(host: HTMLElement, label: string): HTMLDetailsElement {
  const match = [...host.querySelectorAll('details')].find(
    (details) => details.querySelector('summary')?.textContent === label,
  );
  if (!(match instanceof HTMLDetailsElement)) throw new Error(`Details not rendered: ${label}`);
  return match;
}
