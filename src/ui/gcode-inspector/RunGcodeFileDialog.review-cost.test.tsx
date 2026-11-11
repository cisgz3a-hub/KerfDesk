// The Run dialog never repeats a whole-program pass on a render (rolling
// audit v11 W7-P2-1, ADR-630 Amendment 9). It re-renders on every controller,
// motion, connection and streamer change, through the Frame and into the
// stream Start begins; each render once re-ran the review on the UI thread,
// 1.0-1.5 s per 500k lines, and held Abort behind it. The review is made once
// per program, start and context, beside the parse.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as externalProgram from '../../core/external-program';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import * as externalRun from './external-run';
import { RunGcodeFileDialog } from './RunGcodeFileDialog';

vi.mock('../../core/external-program', async (importOriginal) => {
  const actual = await importOriginal<typeof externalProgram>();
  return {
    ...actual,
    reviewExternalProgram: vi.fn(actual.reviewExternalProgram),
    findLitRapids: vi.fn(actual.findLitRapids),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAM = 'G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 Y5 F600\nG0 X20\nM5\n';
const IDLE_AT_ORIGIN = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

const reviews = vi.mocked(externalProgram.reviewExternalProgram);
const litRapidScans = vi.mocked(externalProgram.findLitRapids);

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: parseStatusReport(IDLE_AT_ORIGIN),
  });
  reviews.mockClear();
  litRapidScans.mockClear();
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

// CommandShell rebuilds the Inspector slot with fresh arrow props on every
// render it makes (use-gcode-inspector-slot.tsx), so each call here is one of
// those renders.
function shellRender(onStarted: () => void): void {
  if (host === null) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root?.render(
    <RunGcodeFileDialog
      name="photo.nc"
      text={PROGRAM}
      onClose={() => undefined}
      onStarted={() => onStarted()}
    />,
  );
}

async function render(onStarted: () => void = () => undefined): Promise<void> {
  await act(async () => shellRender(onStarted));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (each) => each.textContent === label,
  );
  if (found === undefined) throw new Error(`${label} missing`);
  return found;
}

async function report(line: string): Promise<void> {
  await act(async () => useLaserStore.setState({ statusReport: parseStatusReport(line) }));
}

describe('Run dialog review cost (ADR-630 Amendment 9)', () => {
  it('reviews once however often the shell re-renders it', async () => {
    await render();
    expect(button('Frame').disabled).toBe(false);
    expect(document.body.textContent).toContain('20 mm × 5 mm');
    expect(reviews).toHaveBeenCalledTimes(1);
    expect(litRapidScans).toHaveBeenCalledTimes(1);
    for (let count = 0; count < 8; count += 1) {
      await render();
      // A status report at the same spot re-renders the controls only.
      await report(IDLE_AT_ORIGIN);
      await act(async () =>
        useLaserStore.setState({ connection: { kind: 'connected' }, controllerOperation: null }),
      );
    }
    expect(reviews).toHaveBeenCalledTimes(1);
    expect(litRapidScans).toHaveBeenCalledTimes(1);
  });

  it('makes no review pass through a Frame and into the stream Start begins', async () => {
    const onStarted = vi.fn();
    await render(onStarted);
    expect(reviews).toHaveBeenCalledTimes(1);
    // The Frame's motion: the head jogs away (startKey turns null, the pinned
    // start holds) and every segment re-renders the shell.
    let finishFrame: () => void = () => undefined;
    vi.spyOn(externalRun, 'frameExternalProgram').mockImplementation(
      (run) =>
        new Promise((resolve) => {
          finishFrame = () => {
            const verification = {
              boundsSignature: 'external:review-cost',
              wco: null,
              workOriginActive: false,
            };
            useLaserStore.setState({
              frameVerification: verification,
              statusReport: parseStatusReport(IDLE_AT_ORIGIN),
            });
            resolve({
              run,
              machineKind: 'laser',
              verification,
              controller: useLaserStore.getState(),
            });
          };
        }),
    );
    await act(async () => button('Frame').click());
    for (const x of ['0.000', '20.000', '20.000', '0.000']) {
      await report(`<Jog|MPos:${x},5.000,0.000|FS:3000,0>`);
      await render(onStarted);
    }
    await act(async () => finishFrame());
    expect(button('Start').disabled).toBe(false);
    expect(reviews).toHaveBeenCalledTimes(1);
    // Start: the first lines go out, the controller reports Run, and the
    // arming state and the shell re-render the dialog before it closes.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Already inside the Start click's act(): plain updates, flushed by awaits.
    const startJob = vi.fn(async () => {
      useLaserStore.setState({
        statusReport: parseStatusReport('<Run|MPos:0.000,0.000,0.000|FS:600,500>'),
      });
      shellRender(onStarted);
      await Promise.resolve();
      useLaserStore.setState({ controllerOperation: null });
      shellRender(onStarted);
      await Promise.resolve();
    });
    useLaserStore.setState({ startJob });
    await act(async () => button('Start').click());
    expect(document.querySelector('[role="alert"]')?.textContent ?? null).toBeNull();
    expect(startJob).toHaveBeenCalledOnce();
    expect(onStarted).toHaveBeenCalledOnce();
    expect(reviews).toHaveBeenCalledTimes(1);
    // Start's laser-mode acknowledgement reuses the worker's lit-rapid scan.
    expect(litRapidScans).toHaveBeenCalledTimes(1);
  });

  it('reviews again when the head comes to rest somewhere new', async () => {
    await render();
    expect(reviews).toHaveBeenCalledTimes(1);
    await report('<Idle|MPos:4.000,3.000,0.000|FS:0,0>');
    expect(reviews).toHaveBeenCalledTimes(2);
    expect(reviews.mock.calls[1]?.[2]).toMatchObject({ start: { x: 4, y: 3, z: 0 } });
    expect(document.body.textContent).toContain('X 4 mm, Y 3 mm');
  });
});
