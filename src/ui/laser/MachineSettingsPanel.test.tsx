import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { MachineSettingsPanel } from './MachineSettingsPanel';

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
      expect(host.textContent).toContain('Max spindle speed');
      expect(host.textContent).toContain('$999');
      expect(host.textContent).toContain('Unknown GRBL setting');
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
      write: async (text) => {
        written = text;
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
        expect.objectContaining({ code: '$30', rawValue: '1000' }),
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

async function renderPanel(platform = makePlatform()): Promise<{
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
        <MachineSettingsPanel />
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
