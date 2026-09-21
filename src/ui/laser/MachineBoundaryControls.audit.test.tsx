import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer } from '../../core/scene';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { BoardCapturePanel } from './board-capture/BoardCapturePanel';
import { UserMacroPanel } from './console/user-macros/UserMacroPanel';
import { readUserMacros } from './console/user-macros/user-macro-storage';
import { JogPadAirAssist } from './JogPadAirAssist';
import { LaserWindow } from './LaserWindow';
import { FirmwareWritesPanel } from './MachineSetupController';
import { ImportExportPanel } from './MachineSetupImportExport';
import { SuperConsoleDiagnostics } from './super-console/SuperConsoleDiagnostics';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;
const platform = {
  id: 'mock' as const,
  pickFilesForOpen: vi.fn(async () => [] as Array<{ name: string; text: () => Promise<string> }>),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: async () => null },
};
beforeEach(() => {
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(original, true);
  resetStore();
  useUiStore.setState({ boardCapturePanelOpen: false });
  vi.restoreAllMocks();
  localStorage.clear();
});
function render(node: ReactNode): void {
  act(() => root.render(<PlatformProvider adapter={platform}>{node}</PlatformProvider>));
}
function button(text: string): HTMLButtonElement {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}

describe('Machine boundary control audit', () => {
  it.each(['none', 'M8'] as const)(
    'Cancel manual-air setup for %s closes its notice without changing defaults or sending air',
    (airAssistCommand) => {
      useStore.getState().updateDeviceProfile({ airAssistCommand });
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            layers: [
              { ...createLayer({ id: 'cut', color: '#ff0000' }), output: true, airAssist: false },
            ],
          },
        },
      }));
      const setAirAssistEnabled = vi.fn(async () => undefined);
      useLaserStore.setState({ setAirAssistEnabled });
      const project = useStore.getState().project;
      render(<JogPadAirAssist />);
      act(() => host.querySelector<HTMLButtonElement>('button')!.click());
      const cancel = host.querySelector<HTMLButtonElement>(
        '[aria-label="Cancel air assist setup"]',
      )!;
      expect(cancel).not.toBeNull();
      act(() => cancel.click());
      expect(host.querySelector('[aria-label="Cancel air assist setup"]')).toBeNull();
      expect(useStore.getState().project).toBe(project);
      expect(setAirAssistEnabled).not.toHaveBeenCalled();
    },
  );

  it('macro Cancel discards the editor and native macro disclosure toggles without persisting a macro', () => {
    const onRun = vi.fn(async () => undefined);
    render(<UserMacroPanel isSending={false} isInputDisabled={false} onRun={onRun} />);
    const details = host.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    act(() => summary.click());
    expect(details.open).toBe(true);
    act(() => button('New macro').click());
    expect(host.querySelector('[aria-label="Macro name"]')).not.toBeNull();
    act(() => button('Cancel').click());
    expect(host.querySelector('[aria-label="Macro name"]')).toBeNull();
    expect(readUserMacros()).toEqual([]);
    expect(onRun).not.toHaveBeenCalled();
    act(() => summary.click());
    expect(details.open).toBe(false);
  });

  it('board panel Close clears only its visibility when no motion is active', () => {
    useUiStore.setState({ boardCapturePanelOpen: true });
    const project = useStore.getState().project;
    render(<BoardCapturePanel />);
    const close = host.querySelector<HTMLButtonElement>(
      '[aria-label="Close board capture panel"]',
    )!;
    act(() => close.click());
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(false);
    expect(useStore.getState().project).toBe(project);
  });

  it('legacy guarded-write confirmation enables only the exact selected mocked setting write', async () => {
    const writeGrblSetting = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
      lastSettingsReadAt: Date.now(),
      writeGrblSetting,
    });
    render(<FirmwareWritesPanel />);
    expect(button('Write $30').disabled).toBe(true);
    await act(async () => button('Write $30').click());
    expect(writeGrblSetting).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLInputElement>('[aria-label="Confirm write $30"]')!.click());
    await act(async () => button('Write $30').click());
    expect(writeGrblSetting).toHaveBeenCalledExactlyOnceWith(30, '1000');
  });

  it('LightBurn import stays in review until Apply and applies only the parsed profile', async () => {
    platform.pickFilesForOpen.mockResolvedValueOnce([
      {
        name: 'audit.lbdev',
        text: async () =>
          '<LightBurnDevice><Name>Audit imported</Name><Controller>GRBL</Controller><Width>410</Width><Height>390</Height><Origin>FrontLeft</Origin><SMax>1000</SMax></LightBurnDevice>',
      },
    ]);
    const before = useStore.getState().project.device;
    render(<ImportExportPanel />);
    await act(async () => button('Import LightBurn .lbdev').click());
    expect(useStore.getState().project.device).toBe(before);
    await act(async () => button('Apply imported profile').click());
    expect(useStore.getState().project.device).toMatchObject({
      name: 'Audit imported',
      bedWidth: 410,
      bedHeight: 390,
      profileSource: 'lightburn',
    });
  });

  it('diagnostic category disclosures open and close without mutating controller readback', () => {
    const rows = settingsMapToRows(
      new Map([
        [30, '1000'],
        [120, '500'],
        [130, '400'],
      ]),
    );
    render(
      <SuperConsoleDiagnostics profile={DEFAULT_DEVICE_PROFILE} machine={undefined} rows={rows} />,
    );
    const details = [...host.querySelectorAll('details')];
    expect(details.length).toBeGreaterThan(0);
    for (const item of details) {
      const summary = item.querySelector('summary')!;
      act(() => summary.click());
      expect(item.open).toBe(false);
      act(() => summary.click());
      expect(item.open).toBe(true);
    }
    expect(rows.map((row) => row.rawValue)).toEqual(['1000', '500', '400']);
  });

  it('alarm Home and explicit Unlock invoke separate mocked recovery actions', async () => {
    const home = vi.fn(async () => undefined);
    const unlock = vi.fn(async () => undefined);
    useStore.getState().updateDeviceProfile({ homing: { enabled: true, direction: 'front-left' } });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Alarm',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      home,
      unlockAlarm: unlock,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LaserWindow />);
    await act(async () => button('Home ($H)').click());
    expect(home).toHaveBeenCalledTimes(1);
    await act(async () => button('$X — Unlock').click());
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});
