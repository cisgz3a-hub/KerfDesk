// Rolling audit v3 G7-P3-1: the real Place Board panel behind the real remote
// adapter. A remote capture_board_point must be refused whenever the PC's
// Capture button is disabled, and remote finish_board must respect what the PC
// shows before Finish (ADR-654 Amendment 1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { findRegistrationBoxes } from '../../core/scene';
import { UNRESTRICTED_EDITION, setActiveEdition } from '../licensing/edition';
import { boardCaptureBlockMessage } from '../laser/board-capture/board-capture-gate';
import { BoardCapturePanel } from '../laser/board-capture/BoardCapturePanel';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { MachineAuthority, MachineOperation } from './machine-types';
import type { RemoteControlAdapter } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
let adapter: RemoteControlAdapter;
let authorityController: AbortController;
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function reportAt(state: StatusReport['state'], x: number, y: number): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

async function setHead(state: StatusReport['state'], x: number, y: number): Promise<void> {
  await act(async () => {
    useLaserStore.setState((laser) => ({
      statusReport: reportAt(state, x, y),
      statusSequence: laser.statusSequence + 1,
    }));
  });
}

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...(host?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === text) ??
    null
  );
}

async function pcCapture(x: number, y: number): Promise<void> {
  await setHead('Idle', x, y);
  const capture = buttonByText('Capture corner');
  if (capture === null || capture.disabled) throw new Error('PC Capture is not available');
  await act(async () => {
    capture.click();
    await Promise.resolve();
  });
}

async function remote(command: 'capture_board_point' | 'finish_board'): Promise<MachineOperation> {
  const args = writeArgs(adapter);
  const read = async () => {
    const result = await adapter.execute('get_control_operation', { operationId: args.requestId });
    if (!result.ok) throw new Error(result.error.code);
    return result.data['operation'] as MachineOperation;
  };
  expect(resultCode(await adapter.execute(command, args))).toBe('ok');
  await vi.waitFor(
    async () => {
      expect(['accepted', 'running']).not.toContain((await read()).state);
    },
    { timeout: 4_000 },
  );
  return read();
}

function capturedBoard() {
  return findRegistrationBoxes(useStore.getState().project.scene).find(
    (box) => box.provenance === 'captured-board',
  );
}

beforeEach(async () => {
  useStore.getState().newProject();
  setActiveEdition(UNRESTRICTED_EDITION);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    setOriginHere: vi.fn(async () => undefined),
    wcoCache: null,
    statusReport: reportAt('Idle', 10, 10),
    statusSequence: 1,
    // The controller answers a status query with the head where it stands.
    requestControllerStatus: vi.fn(async () => {
      useLaserStore.setState((laser) => ({ statusSequence: laser.statusSequence + 1 }));
    }),
  });
  authorityController = new AbortController();
  const authority: MachineAuthority = {
    clientId: 'board-client',
    sessionId: 'board-session',
    signal: authorityController.signal,
    assertCurrent: () => authorityController.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => ({ clientId: authority.clientId, sessionId: authority.sessionId }),
    captureMachineAuthority: () => authority,
  });
  useUiStore.setState({ boardCapturePanelOpen: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<BoardCapturePanel />);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  adapter.dispose();
  authorityController.abort();
  setActiveEdition(null);
  useUiStore.setState({ boardCapturePanelOpen: false });
  useLaserStore.setState(originalLaserState, true);
  useStore.getState().newProject();
});

describe('Remote Place Board capture on the real panel (G7-P3-1)', () => {
  it('refuses a capture during a PC jog, then captures and finishes at Idle', async () => {
    // Three corners of a 100 × 50 board, captured on the PC at Idle.
    await pcCapture(10, 10);
    await pcCapture(110, 10);
    await pcCapture(110, 60);

    // A PC jog is live with the head 4 mm past the last corner.
    await act(async () => {
      useLaserStore.setState({ motionOperation: startMotionOperation('jog') });
    });
    await setHead('Jog', 10, 64);
    expect(buttonByText('Capture corner')?.disabled).toBe(true);
    const pcReason = boardCaptureBlockMessage(useLaserStore.getState());

    const refused = await remote('capture_board_point');
    expect(refused).toMatchObject({ state: 'failed', committed: false, message: pcReason });
    expect(host?.textContent).toContain('Corner 4 of 4');

    // The jog ends on the corner; the remote capture now records it.
    await act(async () => {
      useLaserStore.setState({ motionOperation: null });
    });
    await setHead('Idle', 10, 60);
    const captured = await remote('capture_board_point');
    expect(captured).toMatchObject({ state: 'completed', message: 'Captured point 4 of 4.' });

    const finished = await remote('finish_board');
    expect(finished.state).toBe('completed');
    expect(capturedBoard()?.spec).toMatchObject({ kind: 'rect', widthMm: 100, heightMm: 50 });
  });

  it('undoes a remote finish and its User Origin in one step (ADR-654 Amendment 2)', async () => {
    useStore.getState().setJobPlacement({ startFrom: 'absolute', anchor: 'front-left' });
    await pcCapture(10, 10);
    await pcCapture(110, 10);
    await pcCapture(110, 60);
    await setHead('Idle', 10, 60);
    expect((await remote('capture_board_point')).state).toBe('completed');
    expect((await remote('finish_board')).state).toBe('completed');
    expect(useStore.getState().jobPlacement.startFrom).toBe('user-origin');

    await act(async () => useStore.getState().undo());
    expect(capturedBoard()).toBeUndefined();
    expect(useStore.getState().jobPlacement.startFrom).toBe('absolute');
  });

  it('refuses a remote finish the PC would warn about, and leaves the PC able to create it', async () => {
    await pcCapture(10, 10);
    await pcCapture(110, 10);
    await pcCapture(110, 60);
    await setHead('Idle', 18, 60);
    expect((await remote('capture_board_point')).state).toBe('completed');
    // The PC shows its warning above Create board outline.
    expect(host?.textContent).toContain("The corners aren't a clean rectangle square to the bed");

    const refused = await remote('finish_board');

    expect(refused.state).toBe('failed');
    expect(refused.message).toContain('8 mm off a rectangle square to the bed');
    expect(capturedBoard()).toBeUndefined();
    expect(buttonByText('Create board outline')?.disabled).toBe(false);
  });
});
