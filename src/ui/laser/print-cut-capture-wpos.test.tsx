// GRBL reports the machine position (MPos) or the work position (WPos), as $10
// selects, never both, and MPos = WPos + WCO, where WCO comes in only some
// reports. Capture head read only MPos, so a controller set to report WPos left
// it disabled with no reason (controller audit R-5, ADR-375). The status lines
// below go through the store's own status handling, as the controller sends
// them.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L522-L527
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L548-L552

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { makeLineHandlerHarness } from '../state/laser-line-handler.test-support';
import { handleStatusLine } from '../state/laser-status-line';
import { withheldControllerMPos } from '../state/laser-status-position';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { resolveNativeBedFrame } from '../state/native-bed-frame';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { PrintAndCutDialogHost } from './PrintAndCutDialogHost';
import { capturedMachinePointToScene } from './print-cut-capture-frame';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null;

/** A status line from the controller, through the store's status handling. */
function receive(line: string): void {
  const report = parseStatusReport(line);
  if (report === null) throw new Error(`status line did not parse: ${line}`);
  const { refs } = makeLineHandlerHarness();
  handleStatusLine(
    useLaserStore.setState,
    useLaserStore.getState,
    refs,
    async () => undefined,
    report,
  );
}

async function renderHost(): Promise<void> {
  await act(async () => {
    root = createRoot(host);
    root.render(<PrintAndCutDialogHost onClose={() => undefined} />);
  });
}

function captureButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter((button) =>
    button.textContent?.includes('Capture head'),
  );
}

/** The scene point print-cut-capture-frame gives an MPos report of `mPos`. */
function sceneFromMPos(mPos: { x: number; y: number; z: number }, reportInches: boolean) {
  const { device } = useStore.getState().project;
  const frame = resolveNativeBedFrame(device, useLaserStore.getState());
  return capturedMachinePointToScene(mPos, device, reportInches, frame);
}

async function captureHead(which: 0 | 1): Promise<void> {
  const button = captureButtons()[which];
  if (button === undefined) throw new Error('no Capture head button');
  await act(async () => button.click());
}

beforeEach(() => {
  const base = createProject();
  useStore.setState({
    project: { ...base, printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } } },
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    trustedPositionEpoch: 4,
  });
  usePrintCutSessionStore.getState().clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
  usePrintCutSessionStore.getState().clear();
  useLaserStore.setState(initialLaserState());
});

describe('Print and Cut Capture head from a controller that reports WPos', () => {
  it('captures WPos plus the work offset as the point an MPos report gives', async () => {
    receive('<Idle|WPos:5.000,10.000,0.000|FS:0,0|WCO:15.000,20.000,0.000>');
    receive('<Idle|WPos:5.000,10.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    await renderHost();
    expect(captureButtons().map((button) => button.disabled)).toEqual([false, false]);

    await captureHead(0);
    await act(async () => receive('<Idle|MPos:20.000,30.000,0.000|FS:0,0>'));
    await captureHead(1);

    const { first, second } = usePrintCutSessionStore.getState();
    const expected = sceneFromMPos({ x: 20, y: 30, z: 0 }, false);
    expect(first).toMatchObject({ point: expected, source: 'head' });
    expect(second?.point).toEqual(expected);
  });

  it('converts inch reports once, as it does an inch MPos report', async () => {
    useLaserStore.setState({ controllerSettings: { reportInches: true } });
    receive('<Idle|WPos:0.5000,1.0000,0.0000|FS:0,0|WCO:0.5000,0.5000,0.0000>');
    await renderHost();

    await captureHead(0);
    await act(async () => receive('<Idle|MPos:1.0000,1.5000,0.0000|FS:0,0>'));
    await captureHead(1);

    const { first, second } = usePrintCutSessionStore.getState();
    const expected = sceneFromMPos({ x: 1, y: 1.5, z: 0 }, true);
    expect(expected).not.toEqual(sceneFromMPos({ x: 1, y: 1.5, z: 0 }, false));
    expect(first?.point).toEqual(expected);
    expect(second?.point).toEqual(expected);
  });

  it('says it waits for the work offset, and captures once one arrives', async () => {
    receive('<Idle|WPos:5.000,10.000,0.000|FS:0,0>');
    await renderHost();
    expect(captureButtons().every((button) => button.disabled)).toBe(true);
    expect(host.textContent).toContain('Capture head is waiting for the work offset (WCO).');

    await act(async () => receive('<Idle|WPos:5.000,10.000,0.000|FS:0,0|WCO:15.000,20.000,0.000>'));

    expect(captureButtons().every((button) => !button.disabled)).toBe(true);
    expect(host.textContent).not.toContain('Capture head is waiting');
  });
});

describe('Print and Cut Capture head without a machine position', () => {
  const withheld: ReadonlyArray<readonly [string, Partial<LaserState>, string]> = [
    [
      'after Unlock',
      { positionEvidenceSuppressed: true },
      'Capture head is waiting for a trusted head position.',
    ],
    [
      'after a $13 write',
      { reportUnitsUnconfirmed: true },
      'Capture head is waiting for the report units:',
    ],
  ];

  it.each(withheld)('says why while KerfDesk withholds the position %s', async (_, patch, why) => {
    useLaserStore.setState(patch);
    receive('<Idle|MPos:20.000,30.000,0.000|FS:0,0|WCO:15.000,20.000,0.000>');
    expect(useLaserStore.getState().statusReport?.mPos).toBeNull();
    await renderHost();

    expect(captureButtons().every((button) => button.disabled)).toBe(true);
    expect(host.textContent).toContain(why);
  });

  it('never captures the MPos withheld for the jog clamp (M-3)', async () => {
    useLaserStore.setState({ positionEvidenceSuppressed: true });
    receive('<Idle|MPos:20.000,30.000,0.000|FS:0,0>');
    expect(withheldControllerMPos(useLaserStore.getState().statusReport)).not.toBeNull();
    await renderHost();

    await captureHead(0);

    expect(usePrintCutSessionStore.getState().first).toBeNull();
  });

  it('says it waits for the machine position when a report carries none', async () => {
    receive('<Idle|FS:0,0>');
    await renderHost();

    expect(captureButtons().every((button) => button.disabled)).toBe(true);
    expect(host.textContent).toContain('Capture head needs the machine position');
  });
});
