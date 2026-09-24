import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_ORIGIN_ANCHORS } from '../../core/job';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { CollapsibleRailSection } from './CollapsibleRailSection';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { FocusJogControls } from './FocusJogControls';
import { JobPlacementControls } from './JobPlacementControls';
import { MachineSettingsPanel } from './MachineSettingsPanel';
import { MeasuredScanOffsetApply } from './MeasuredScanOffsetApply';
import { ProbePanel } from './ProbePanel';
import { StartFromLineControl } from './StartFromLineControl';
import { runStartFromLineFlow } from './start-job-flow';

vi.mock('./start-job-flow', () => ({ runStartFromLineFlow: vi.fn(async () => undefined) }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const original = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root;
const platform = {
  id: 'mock' as const,
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: async () => null },
};
beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(original, true);
  resetStore();
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
function input(label: string): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!node) throw new Error(`Missing input: ${label}`);
  return node;
}

describe('Machine utility control audit', () => {
  it('audit selected-only and selected-origin toggles persist their distinct output scope fields', () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    render(<JobPlacementControls streaming={false} />);
    act(() => input('Selected artwork only').click());
    expect(useStore.getState().outputScopeSettings.cutSelectedGraphics).toBe(true);
    act(() => input('Anchor from selected artwork').click());
    expect(useStore.getState().outputScopeSettings.useSelectionOrigin).toBe(true);
    act(() => input('Anchor from selected artwork').click());
    expect(useStore.getState().outputScopeSettings.useSelectionOrigin).toBe(false);
    act(() => input('Selected artwork only').click());
    expect(useStore.getState().outputScopeSettings.cutSelectedGraphics).toBe(false);
  });
  it.each([
    [
      'rail',
      () => (
        <CollapsibleRailSection label="Advanced controls">
          <span>Details</span>
        </CollapsibleRailSection>
      ),
    ],
    ['execution archive', () => <ExecutionArchivePanel />],
    ['controller backup', () => <MachineSettingsPanel />],
    ['probe', () => <ProbePanel />],
    [
      'laser recovery',
      () => <StartFromLineControl disabled={false} busy={false} machineKind="laser" />,
    ],
    [
      'CNC recovery guidance',
      () => <StartFromLineControl disabled={false} busy={false} machineKind="cnc" />,
    ],
  ] as const)('%s disclosure opens and closes without changing the project', (name, node) => {
    if (name === 'probe') useStore.getState().setMachineKind('cnc');
    const project = useStore.getState().project;
    render(node());
    const details = host.querySelector('details')!;
    const summary = details.querySelector('summary')!;
    const initial = details.open;
    act(() => summary.click());
    expect(details.open).toBe(!initial);
    act(() => summary.click());
    expect(details.open).toBe(initial);
    expect(useStore.getState().project).toBe(project);
  });

  it('laser Resume from line sends the selected line, stays inert while busy, and is absent for CNC', async () => {
    render(<StartFromLineControl disabled={false} busy={false} machineKind="laser" />);
    act(() => {
      input('Resume from G-code line').value = '23';
      Simulate.change(input('Resume from G-code line'));
    });
    await act(async () => button('Resume from line').click());
    expect(runStartFromLineFlow).toHaveBeenCalledExactlyOnceWith(23);
    render(<StartFromLineControl disabled={false} busy={true} machineKind="laser" />);
    await act(async () => button('Resume from line').click());
    expect(runStartFromLineFlow).toHaveBeenCalledTimes(1);
    render(<StartFromLineControl disabled={false} busy={false} machineKind="cnc" />);
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toContain('Automatic line-number restart remains blocked');
  });

  it('detected settings Apply changes safe profile fields and Dismiss clears the offer only', () => {
    useLaserStore.setState({ detectedSettings: { maxPowerS: 1234 } });
    render(<DetectedSettingsBanner />);
    act(() => button('Apply safe settings').click());
    expect(useStore.getState().project.device.maxPowerS).toBe(1234);
    act(() => useLaserStore.setState({ detectedSettings: { maxPowerS: 987 } }));
    render(<DetectedSettingsBanner />);
    act(() => button('Dismiss').click());
    expect(useLaserStore.getState().detectedSettings).toBeNull();
    expect(useStore.getState().project.device.maxPowerS).toBe(1234);
  });

  it('Zero Z dispatches only the CNC zero callback and is inert when controls are disabled', () => {
    const props = {
      device: useStore.getState().project.device,
      machineKind: 'cnc' as const,
      disabled: false,
      focusStep: 1,
      setFocusStep: vi.fn(),
      onJog: vi.fn(),
      onZeroZ: vi.fn(),
    };
    render(<FocusJogControls {...props} />);
    act(() => button('Zero Z').click());
    expect(props.onZeroZ).toHaveBeenCalledTimes(1);
    expect(props.onJog).not.toHaveBeenCalled();
    render(<FocusJogControls {...props} disabled={true} />);
    act(() => button('Zero Z').click());
    expect(props.onZeroZ).toHaveBeenCalledTimes(1);
  });

  it('all nine job-origin buttons persist their exact anchor and remain inert while streaming', () => {
    useStore.getState().setJobPlacement({ startFrom: 'user-origin' });
    render(<JobPlacementControls streaming={false} />);
    for (const anchor of JOB_ORIGIN_ANCHORS) {
      const node = host.querySelector<HTMLButtonElement>(
        `button[aria-label="Job origin ${anchor}"]`,
      )!;
      act(() => node.click());
      expect(useStore.getState().jobPlacement.anchor).toBe(anchor);
    }
    const before = useStore.getState().jobPlacement;
    render(<JobPlacementControls streaming={true} />);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Job origin center"]')!.click());
    expect(useStore.getState().jobPlacement).toBe(before);
  });

  it('Reset measurements restores saved offsets and legacy Mark verified records explicit provenance', () => {
    useStore.getState().updateDeviceProfile({
      scanningOffsets: [{ speedMmPerMin: 2000, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: undefined,
    });
    render(<MeasuredScanOffsetApply />);
    act(() => {
      input('Measured offset 1').value = '0.2';
      Simulate.change(input('Measured offset 1'));
    });
    act(() => button('Reset from profile').click());
    expect(input('Measured offset 1').value).toBe('0.1');
    expect(useStore.getState().project.device.scanningOffsets).toEqual([
      { speedMmPerMin: 2000, offsetMm: 0.1 },
    ]);
    act(() => button('Mark verified').click());
    expect(useStore.getState().project.device.scanOffsetCalibrationStatus).toBe('verified');
  });
});
