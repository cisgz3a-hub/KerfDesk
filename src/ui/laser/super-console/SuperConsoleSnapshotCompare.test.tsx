import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createControllerSettingsSnapshot,
  deserializeControllerSettingsSnapshot,
  serializeControllerSettingsSnapshot,
} from '../../../io/controller-settings-snapshot';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useLaserStore } from '../../state/laser-store';
import { SuperConsoleSnapshotCompare } from './SuperConsoleSnapshotCompare';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({
    grblSettingsRows: [],
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SuperConsoleSnapshotCompare', () => {
  it('exports the current readback with an operator machine label', async () => {
    const write = vi.fn(async (_data: string | Blob) => undefined);
    const platform = makePlatform({
      pickFileForSave: vi.fn(async () => ({ displayName: '4040.lfsettings.json', write })),
    });
    useLaserStore.setState({
      grblSettingsRows: settingsMapToRows(new Map([[120, '250']])),
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const { host, unmount } = await renderCompare(platform);
    const label = requiredInput(host, 'Current controller snapshot label');
    await setInput(label, '4040 test machine');
    await clickButton(host, 'Export current snapshot');

    expect(write).toHaveBeenCalledTimes(1);
    const saved = deserializeControllerSettingsSnapshot(String(write.mock.calls[0]?.[0]));
    expect(saved.kind).toBe('ok');
    if (saved.kind === 'ok') {
      expect(saved.snapshot.operatorLabel).toBe('4040 test machine');
      expect(saved.snapshot.settings).toEqual([{ id: 120, rawValue: '250' }]);
    }
    expect(host.textContent).toContain('Exported read-only snapshot');
    await unmount();
  });

  it('loads two files and compares axis values without a quality verdict', async () => {
    const files = [snapshotText('4040', '250'), snapshotText('Falcon', '500')];
    const pickFilesForOpen = vi
      .fn<PlatformAdapter['pickFilesForOpen']>()
      .mockResolvedValueOnce([{ name: 'a.json', text: async () => files[0] ?? '' }])
      .mockResolvedValueOnce([{ name: 'b.json', text: async () => files[1] ?? '' }]);
    const platform = makePlatform({ pickFilesForOpen });
    const { host, unmount } = await renderCompare(platform);

    await clickButton(host, 'Load A');
    await clickButton(host, 'Load B');

    expect(host.textContent).toContain('1 difference across 1 setting');
    expect(host.textContent).toContain('$120');
    expect(host.textContent).toContain('+250 (+100.0%)');
    expect(host.textContent).toContain('Different');
    expect(host.textContent).toContain('higher speed or acceleration is not treated as better');
    await unmount();
  });
});

async function renderCompare(platform: PlatformAdapter): Promise<{
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
        <SuperConsoleSnapshotCompare profile={DEFAULT_DEVICE_PROFILE} />
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

function makePlatform(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort: async () => null },
    ...overrides,
  };
}

function snapshotText(label: string, acceleration: string): string {
  return serializeControllerSettingsSnapshot(
    createControllerSettingsSnapshot({
      capturedAt: '2026-07-19T00:00:00.000Z',
      operatorLabel: label,
      profile: { profileId: null, name: 'Generic profile' },
      controllerKinds: { profile: null, active: 'grbl-v1.1', detected: null },
      settings: [{ id: 120, rawValue: acceleration }],
    }),
  );
}

function requiredInput(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`${label} input missing`);
  return input;
}

async function setInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButton(host: HTMLElement, label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (button === undefined) throw new Error(`${label} button missing`);
  await act(async () => button.click());
}
