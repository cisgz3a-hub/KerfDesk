import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { CNC_LASER_MODE_ENABLED_MESSAGE } from '../../core/preflight/controller-readiness';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { EXTERNAL_FRAME_FIRST } from './external-run';
import * as externalRun from './external-run';
import { RunGcodeFileDialog } from './RunGcodeFileDialog';
import { CLOSE_WHILE_STARTING } from './RunGcodeFileControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useLaserStore.setState(initialLaserState());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function show(
  text: string,
  onStarted: () => void = vi.fn(),
  onClose: () => void = vi.fn(),
): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <RunGcodeFileDialog name="part.nc" text={text} onClose={onClose} onStarted={onStarted} />,
    ),
  );
  return document.body;
}

function button(body: HTMLElement, label: string): HTMLButtonElement {
  const found = [...body.querySelectorAll('button')].find((each) => each.textContent === label);
  if (found === undefined) throw new Error(`${label} missing`);
  return found;
}

describe('Run G-code file dialog (ADR-630)', () => {
  it('reviews what will be sent and keeps Start locked until a Frame', async () => {
    const body = await show('(job)\nG21 G90\nG0 X10 Y5\nM4 S500\nG1 X60 Y45 F1000\nM5\n');
    expect(body.textContent).toContain('6 lines');
    expect(body.textContent).toContain(
      'G17 G21 G90 G94 G0 (XY plane, millimetres, absolute moves, feed per minute, rapid motion) first',
    );
    expect(body.textContent).toContain('/ marks, % markers and blank lines left out');
    expect(body.textContent).toContain('50 mm × 40 mm');
    expect(body.textContent).toContain('millimetres (G21)');
    // No controller to describe until one is connected (ADR-630 Amendment 4).
    expect(body.textContent).not.toContain('$32');
    expect(button(body, 'Start').disabled).toBe(true);
    expect(button(body, 'Start').title).toBe(EXTERNAL_FRAME_FIRST);
    expect(button(body, 'Frame').disabled).toBe(true);
    expect(button(body, 'Frame').title).toBe('Connect to the machine first.');
  });

  it('enables Frame on a connected, Idle machine', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const body = await show('G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nM5\n');
    expect(button(body, 'Frame').disabled).toBe(false);
  });

  it('reviews and Frames the normalized executable bytes, not the original inspection', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const text = 'G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nG1 X1(note)00\nM5\n';
    const original = buildGcodeRenderModel(text);
    if (original.kind !== 'ok') throw new Error(original.reason);
    expect(original.model.stats.programBounds?.maxX).toBe(10);
    const body = await show(text);
    expect(body.textContent).toContain('100 mm × 0 mm');
    expect(body.textContent).not.toContain('unreadable line');
    expect(button(body, 'Frame').disabled).toBe(false);
    const frame = vi.spyOn(externalRun, 'frameExternalProgram').mockResolvedValue(null);
    await act(async () => button(body, 'Frame').click());
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({
        gcode: 'G17G21G90G94G0\nG21G90\nG0X0Y0\nM4S500\nG1X10F600\nG1X100\nM5\n',
        envelope: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      }),
    );
  });

  // ADR-630 Verification: the dialog through Frame (its motion stubbed), the
  // review, and Start against the store, which receives the exact bytes once.
  it('unlocks Start after a clean Frame and streams the reviewed bytes', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const onStarted = vi.fn();
    const body = await show('G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nM5\n', onStarted);
    expect(button(body, 'Start').disabled).toBe(true);
    vi.spyOn(externalRun, 'frameExternalProgram').mockImplementation(async (run) => {
      const verification = {
        boundsSignature: 'external:dialog',
        wco: null,
        workOriginActive: false,
      };
      useLaserStore.setState({ frameVerification: verification });
      return { run, machineKind: 'laser', verification, controller: useLaserStore.getState() };
    });
    await act(async () => button(body, 'Frame').click());
    expect(body.textContent).toContain('Ready to start');
    expect(button(body, 'Start').disabled).toBe(false);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    await act(async () => button(body, 'Start').click());
    expect(startJob).toHaveBeenCalledTimes(1);
    const [gcode] = startJob.mock.calls[0] as unknown as [string];
    expect(gcode).toBe('G17G21G90G94G0\nG21G90\nG0X0Y0\nM4S500\nG1X10F600\nM5\n');
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it('uses the connected Marlin parser through review, Frame and the exact Start handoff', async () => {
    useLaserStore.setState({
      activeControllerKind: 'marlin',
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    // The saved device remains GRBL: the connected driver owns interpretation.
    const text = 'G0 X100\nG90 G0 X0\nG91\nM3 S100\nG1 X10 F600 M5\n';
    const body = await show(text);
    expect(body.textContent).toContain('110 mm × 0 mm');
    expect(body.textContent).toContain('first on separate lines');
    expect(body.textContent).toContain('still on when the program ends');
    const frame = vi.spyOn(externalRun, 'frameExternalProgram').mockImplementation(async (run) => {
      const verification = {
        boundsSignature: 'external:marlin',
        wco: null,
        workOriginActive: false,
      };
      useLaserStore.setState({ frameVerification: verification });
      return { run, machineKind: 'laser', verification, controller: useLaserStore.getState() };
    });
    await act(async () => button(body, 'Frame').click());
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({
        gcode: `G21\nG90\n${text}`,
        envelope: { minX: 0, minY: 0, maxX: 110, maxY: 0 },
      }),
    );
    expect(button(body, 'Start').disabled).toBe(false);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const startJob = vi.fn(async () => undefined);
    useLaserStore.setState({ startJob });
    await act(async () => button(body, 'Start').click());
    expect(startJob).toHaveBeenCalledOnce();
    const [sent] = startJob.mock.calls[0] as unknown as [string];
    expect(sent).toBe(`G21\nG90\n${text}`);
  });

  it('re-reads the program and drops its old Frame when the connected parser changes', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const body = await show('G0 X100\nG90 G0 X0\nG91\nG1 X10 F600\nM5');
    expect(body.textContent).toContain('100 mm × 0 mm');
    vi.spyOn(externalRun, 'frameExternalProgram').mockImplementation(async (run) => {
      const verification = {
        boundsSignature: 'external:old-driver',
        wco: null,
        workOriginActive: false,
      };
      useLaserStore.setState({ frameVerification: verification });
      return { run, machineKind: 'laser', verification, controller: useLaserStore.getState() };
    });
    await act(async () => button(body, 'Frame').click());
    expect(button(body, 'Start').disabled).toBe(false);
    await act(async () => useLaserStore.setState({ activeControllerKind: 'marlin' }));
    expect(body.textContent).toContain('110 mm × 0 mm');
    expect(button(body, 'Start').disabled).toBe(true);
    expect(button(body, 'Start').title).toBe(EXTERNAL_FRAME_FIRST);
  });

  it('cannot be closed while Start is arming the controller', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const onClose = vi.fn();
    const body = await show('G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nM5\n', vi.fn(), onClose);
    vi.spyOn(externalRun, 'frameExternalProgram').mockImplementation(async (run) => {
      const verification = {
        boundsSignature: 'external:arming',
        wco: null,
        workOriginActive: false,
      };
      useLaserStore.setState({ frameVerification: verification });
      return { run, machineKind: 'laser', verification, controller: useLaserStore.getState() };
    });
    await act(async () => button(body, 'Frame').click());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finishArming: () => void = () => undefined;
    const startJob = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishArming = resolve;
        }),
    );
    useLaserStore.setState({ startJob });
    await act(async () => button(body, 'Start').click());
    expect(startJob).toHaveBeenCalledTimes(1);
    const close = button(body, 'Close');
    expect(close.disabled).toBe(true);
    expect(close.title).toBe(CLOSE_WHILE_STARTING);
    await act(async () => {
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finishArming());
    expect(button(body, 'Close').disabled).toBe(false);
    await act(async () => button(body, 'Close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists warnings without blocking anything', async () => {
    const body = await show('G20 G90\nG0 X1 Y1\nM3 S500\nG1 X2 F20\n');
    expect(body.textContent).toContain('Warnings');
    expect(body.textContent).toContain('inches (G20)');
    expect(body.textContent).toContain('never sends M5');
  });

  // ADR-630 Amendment 4: the controller's $30/$32 findings, as Job Review
  // words them, plus the rapids a laser at $32=0 runs lit. Frame stays open.
  it('lists the lit rapids of a laser reporting $32=0', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
      controllerSettings: { laserModeEnabled: false, maxPowerS: 1000 },
    });
    const body = await show('M4\nG1 X10 Y10 S800 F1000\nG0 X10 Y40\nG1 X40 Y40\nM5\n');
    expect(body.textContent).toContain('The controller reports $32=0 (laser mode off)');
    expect(body.textContent).toContain('One rapid command in this program runs with M3 or M4 on');
    expect(body.textContent).toContain('first: line 4 of the sent program');
    expect(body.textContent).toContain('Controller reports $32=0. Enable GRBL laser mode ($32=1)');
    expect(button(body, 'Frame').disabled).toBe(false);
  });

  it('lists a router left in laser mode', async () => {
    useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
      controllerSettings: { laserModeEnabled: true, maxPowerS: 12000 },
    });
    const body = await show('M3 S11000\nG4 P3\nG0 X10 Y10\nG1 Z-2 F300\nG0 Z5\nM5\n');
    expect(body.textContent).toContain(CNC_LASER_MODE_ENABLED_MESSAGE);
    expect(body.textContent).not.toContain('rapid command');
    expect(button(body, 'Frame').disabled).toBe(false);
  });

  // Rolling audit v4 H1-P3-2: KerfDesk's own connected Save writes S words in
  // the controller's $30 range, so the review judges a program against it.
  it.each([
    { profileS: 255, controllerS: 1000, warned: false },
    { profileS: 1000, controllerS: 255, warned: true },
  ])(
    'judges S1000 against the connected S max $controllerS under a profile S$profileS',
    async ({ profileS, controllerS, warned }) => {
      const project = createProject();
      useStore.setState({
        project: { ...project, device: { ...project.device, maxPowerS: profileS } },
      });
      useLaserStore.setState({
        connection: { kind: 'connected' },
        statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
        activeControllerKind: 'grbl-v1.1',
        controllerSessionEpoch: 7,
        controllerSettings: { laserModeEnabled: true, maxPowerS: controllerS },
        controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
      });
      const text = (await show('M4\nG1 X10 Y10 S1000 F1000\nM5\n')).textContent ?? '';
      expect(text.includes('above this laser')).toBe(warned);
      expect(text.includes(`asks for S1000, above this laser's S max of ${controllerS}.`)).toBe(
        warned,
      );
    },
  );

  it('shows the G10 displacement warning while preserving Frame and exact sendable bytes', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const text = 'G21 G90\nG0 X10 Y0\nG10L20P1X0Y0\nM4 S500\nG1 X20 F600\nM5\n';
    const body = await show(text);
    expect(body.textContent).toContain('work-coordinate offsets (G10 L20)');
    expect(body.textContent).toContain('may be displaced from the traced outline');
    expect(button(body, 'Frame').disabled).toBe(false);
    const frame = vi.spyOn(externalRun, 'frameExternalProgram').mockResolvedValue(null);
    await act(async () => button(body, 'Frame').click());
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({
        gcode: 'G17G21G90G94G0\nG21G90\nG0X10Y0\nG10L20P1X0Y0\nM4S500\nG1X20F600\nM5\n',
      }),
    );
  });

  it('explains a file it cannot send, with no Frame or Start', async () => {
    const body = await show('G21\n$H\nG0 X1\n');
    expect(body.textContent).toContain('will not send this file as a job');
    expect(body.textContent).toContain('Line 2 is a $ controller command');
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });

  // Controller audit v4 E4-P2-2 (ADR-630 Amendment 7): FluidNC would run to
  // X120 where the Frame traced X10, so the file is not framed at all.
  it('refuses a FluidNC program it cannot trace, with no Frame or Start', async () => {
    useLaserStore.setState({ activeControllerKind: 'fluidnc' });
    const body = await show('G1 X10 F1000\n#1 = 120\nG1 X#1\n');
    expect(body.textContent).toContain('will not send this file as a job');
    expect(body.textContent).toContain(
      'Line 2 (#1=120) uses a # parameter, which FluidNC works out as the program runs.',
    );
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });

  it('names Smoothieware shell and SD-card lines it will not send (ADR-630 Amendment 5)', async () => {
    useLaserStore.setState({ activeControllerKind: 'smoothieware' });
    const body = await show('G21\nversion\nG0 X1\nM28 notes.txt\n');
    expect(body.textContent).toContain('will not send this file as a job');
    expect(body.textContent).toContain(
      'Line 2 (version) starts with a lowercase letter, so Smoothieware runs it as a shell command',
    );
    expect(body.textContent).toContain('Line 4 (M28notes.txt) is M28');
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });

  it('refuses a Marlin macro program instead of offering its incomplete Frame', async () => {
    useLaserStore.setState({ activeControllerKind: 'marlin' });
    const body = await show('M810 G1 X120 F600\nG1 X10 F600\nM810\nM5\n');
    expect(body.textContent).toContain('will not send this file as a job');
    expect(body.textContent).toContain('Line 1 (M810 G1 X120 F600) is M810');
    expect(body.textContent).toContain('Line 3 (M810) is M810');
    expect(body.textContent).toContain('macro stored on the controller');
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });
});
