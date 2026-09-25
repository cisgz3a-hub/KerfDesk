import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer } from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { fireActions } from '../state/laser-fire-actions';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useStore } from '../state/store';
import { useMachineSetupDialogStore } from './device-setup/machine-setup-dialog-store';
import { MomentaryFireControl } from './MomentaryFireControl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalProject = useStore.getState().project;
const originalSetFireActive = useLaserStore.getState().setFireActive;
let host: HTMLDivElement;
let root: Root;

// No Labs switch and no catalog capability: the machine's opt-in alone arms
// the button (ADR-387).
function installDevice(patch: Partial<DeviceProfile>): void {
  useStore.setState({
    project: {
      ...originalProject,
      machine: { kind: 'laser' },
      device: {
        ...originalProject.device,
        fireControl: { enabled: true, maxPowerPercent: 1 },
        ...patch,
      },
    },
  });
}

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  installDevice({});
  useMachineSetupDialogStore.getState().close();
  useLaserStore.setState({
    connection: { kind: 'connected' },
    capabilities: grblDriver.capabilities,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    mpgActive: null,
    alarmCode: null,
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    autofocusBusy: false,
    probeBusy: false,
    pendingUntrackedAcks: 0,
    fireActive: false,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState({ project: originalProject });
  useMachineSetupDialogStore.getState().close();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    fireActive: false,
    alarmCode: null,
    statusSequence: 0,
    pendingTransportWrites: 0,
    setFireActive: originalSetFireActive,
  });
  localStorage.clear();
  vi.restoreAllMocks();
});

async function renderControl(): Promise<HTMLButtonElement | null> {
  await act(async () => root.render(<MomentaryFireControl />));
  return host.querySelector('button');
}

function mockSetFireActive(): ReturnType<typeof vi.fn<LaserState['setFireActive']>> {
  const setFireActive = vi.fn<LaserState['setFireActive']>(async (active) => {
    useLaserStore.setState({ fireActive: active });
  });
  useLaserStore.setState({ setFireActive });
  return setFireActive;
}

// The real Fire action behind the button, so a test sees the exact bytes a
// press and each laser-off path would put on the wire.
function wireRealFire(): ReturnType<typeof vi.fn<(line: string) => Promise<void>>> {
  const write = vi.fn<(line: string) => Promise<void>>(async () => undefined);
  const { setFireActive } = fireActions(useLaserStore.setState, useLaserStore.getState, write);
  useLaserStore.setState({ setFireActive });
  return write;
}

async function pointerDown(button: HTMLButtonElement | null): Promise<void> {
  await act(async () => button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
}

describe('MomentaryFireControl', () => {
  it('shows the power as a percent and as the exact S word a press sends', async () => {
    installDevice({ maxPowerS: 255, fireControl: { enabled: true, maxPowerPercent: 2 } });
    const write = wireRealFire();
    const button = await renderControl();

    expect(button?.textContent).toContain('2% · S5');
    expect(button?.getAttribute('aria-label')).toBe('Hold for low-power Fire at 2% (S5)');
    expect(button?.title).toBe(
      'Hold to turn on the positioning beam at 2% (S5). Release always sends M5.',
    );

    await pointerDown(button);
    expect(write.mock.calls.map(([line]) => line)).toEqual(['G1 F6000 M3 S5\n']);
  });

  // ADR-162 laser-off paths, each against the real action: every one of them
  // must put M5 on the wire and drop the on latch.
  const releaseSignals: ReadonlyArray<
    readonly [string, (button: HTMLButtonElement | null) => void]
  > = [
    ['pointer release anywhere', () => window.dispatchEvent(new MouseEvent('pointerup'))],
    [
      'the pointer leaving the button',
      (button) =>
        button?.dispatchEvent(
          new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
        ),
    ],
    ['a cancelled pointer', () => window.dispatchEvent(new MouseEvent('pointercancel'))],
    ['the window losing focus', () => window.dispatchEvent(new Event('blur'))],
    ['the button losing focus', (button) => button?.blur()],
    [
      'a Space keyup anywhere',
      () => window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })),
    ],
    [
      'the page going hidden',
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      },
    ],
    ['unmounting', () => root.unmount()],
    [
      'the machine opt-in being withdrawn',
      () => installDevice({ fireControl: { enabled: false, maxPowerPercent: 1 } }),
    ],
  ];
  for (const [name, signal] of releaseSignals) {
    it(`sends M5 on ${name}`, async () => {
      const write = wireRealFire();
      const button = await renderControl();
      button?.focus();
      await pointerDown(button);
      expect(useLaserStore.getState().fireActive).toBe(true);

      await act(async () => signal(button));

      expect(write.mock.calls.map(([line]) => line)).toEqual(['G1 F6000 M3 S10\n', 'M5\n']);
      expect(useLaserStore.getState().fireActive).toBe(false);
    });
  }

  it('asks for M5 at once when the activation write fails with the latch on', async () => {
    const setFireActive = vi.fn<LaserState['setFireActive']>(async (active) => {
      useLaserStore.setState({ fireActive: active });
      if (active) throw new Error('ambiguous activation write');
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();

    await pointerDown(button);

    expect(setFireActive.mock.calls).toEqual([[true, 1], [false]]);
    expect(useLaserStore.getState().fireActive).toBe(false);
  });

  it('sends nothing after a refused press that latched nothing', async () => {
    const setFireActive = vi.fn<LaserState['setFireActive']>(async () => {
      throw new Error('Wait for the controller to acknowledge the previous command.');
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();

    await pointerDown(button);
    await act(async () => window.dispatchEvent(new MouseEvent('pointerup')));

    expect(setFireActive.mock.calls).toEqual([[true, 1]]);
  });

  it('hard-offs on global keyup after acknowledgement disables the focused button', async () => {
    const setFireActive = vi.fn<LaserState['setFireActive']>(async (active) => {
      useLaserStore.setState(
        active
          ? { fireActive: true, pendingUntrackedAcks: 1 }
          : { fireActive: false, pendingUntrackedAcks: 0 },
      );
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();
    button?.focus();

    await act(async () =>
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })),
    );
    expect(button?.disabled).toBe(true);

    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })));

    expect(setFireActive).toHaveBeenLastCalledWith(false);
  });

  it('coalesces simultaneous fail-off signals when laser-off is rejected', async () => {
    const setFireActive = vi.fn<LaserState['setFireActive']>(async (active) => {
      if (!active) throw new Error('Port write failed.');
      useLaserStore.setState({ fireActive: true });
    });
    useLaserStore.setState({ setFireActive });
    const button = await renderControl();
    await act(async () =>
      button?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })),
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
      window.dispatchEvent(new Event('blur'));
    });

    expect(setFireActive.mock.calls.filter(([active]) => active === false)).toHaveLength(1);
    expect(useLaserStore.getState().fireActive).toBe(true);
  });

  it('names why a blocked button cannot fire instead of hiding it', async () => {
    const setFireActive = mockSetFireActive();
    const blocked: ReadonlyArray<readonly [string, Partial<LaserState>, string]> = [
      ['Not connected', { connection: { kind: 'disconnected' } }, 'Connect to the laser first.'],
      ['Alarm', { alarmCode: 9 }, 'Clear the controller alarm before using Fire.'],
      [
        'Job running',
        { streamer: { ...createStreamer('G1 X1\n'), status: 'streaming' } },
        'A job is active. Request ABORT before using Fire.',
      ],
      [
        'Not idle',
        { statusReport: { ...useLaserStore.getState().statusReport!, state: 'Run' } },
        'Machine must be Idle before using Fire (currently Run).',
      ],
    ];
    const ready = useLaserStore.getState();
    for (const [caption, patch, message] of blocked) {
      await act(async () => useLaserStore.setState({ ...ready, ...patch, setFireActive }));
      const button = await renderControl();

      expect(button?.disabled, caption).toBe(true);
      expect(button?.textContent, caption).toContain(caption);
      expect(button?.textContent, caption).toContain('1% · S10');
      expect(button?.title, caption).toBe(`${message} Fire sends 1% (S10) once ready.`);
      await pointerDown(button);
    }
    expect(setFireActive).not.toHaveBeenCalled();
  });

  it('offers Set up for a machine that has not opted in, even while disconnected', async () => {
    const setFireActive = mockSetFireActive();
    // A profile that never configured Fire carries no fireControl at all.
    const { fireControl: _neverConfigured, ...device } = useStore.getState().project.device;
    useStore.setState({ project: { ...useStore.getState().project, device } });
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    const button = await renderControl();

    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain('Set up');
    expect(button?.getAttribute('aria-label')).toBe('Set up the Fire button for this machine');
    expect(button?.title).toContain('Enable Fire button');

    await pointerDown(button);
    await act(async () => button?.click());

    expect(setFireActive).not.toHaveBeenCalled();
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'step', step: 'confirm', highlight: 'fire' },
    });
  });

  it('explains a machine that can never offer Fire and keeps it disabled', async () => {
    const setFireActive = mockSetFireActive();
    const cases: ReadonlyArray<readonly [Partial<DeviceProfile>, string]> = [
      [{ controllerKind: 'marlin' }, 'Marlin controllers have no Fire button'],
      [
        {
          laserSubProfile: {
            model: '60 W tube',
            technology: 'co2',
            focusMode: 'manual',
            airAssist: 'none',
          },
        },
        'invisible beam',
      ],
    ];
    for (const [patch, reason] of cases) {
      installDevice(patch);
      const button = await renderControl();

      expect(button?.disabled, reason).toBe(true);
      expect(button?.textContent, reason).toContain('Unavailable');
      expect(button?.getAttribute('aria-label'), reason).toContain(reason);
      await pointerDown(button);
    }
    expect(setFireActive).not.toHaveBeenCalled();
  });

  it('has no Fire button on a CNC project', async () => {
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    expect(await renderControl()).toBeNull();
  });

  it('keeps working for a profile opted in under the retired Labs gate', async () => {
    localStorage.setItem(
      'kerfdesk.experimental-laser-features.v1',
      JSON.stringify({ lowPowerFire: true, printAndCut: false, cameraAlignmentV2: true }),
    );
    const setFireActive = mockSetFireActive();
    const button = await renderControl();

    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain('HOLD');
    await pointerDown(button);
    expect(setFireActive).toHaveBeenCalledWith(true, 1);
  });

  // Always mounted in the jog pad: store writes it does not read — the per-ack
  // transport bookkeeping and the status poll's sequence — must not render it.
  it('renders only for the laser state it reads', async () => {
    let commits = 0;
    await act(async () =>
      root.render(
        <Profiler id="fire" onRender={() => (commits += 1)}>
          <MomentaryFireControl />
        </Profiler>,
      ),
    );
    commits = 0;

    for (let sequence = 1; sequence <= 5; sequence += 1) {
      await act(async () =>
        useLaserStore.setState({ statusSequence: sequence, pendingTransportWrites: sequence }),
      );
    }
    expect(commits).toBe(0);

    await act(async () => useLaserStore.setState({ alarmCode: 9 }));
    expect(commits).toBe(1);
    expect(host.querySelector('button')?.disabled).toBe(true);
  });
});
