// Annoyance audit A3-P2-2, ADR-674 Amendment 1: the machine rail must hand the
// jog pad `stepJogsOnly` while an operator step jog runs, so a second quick tap
// or XY key joins that jog. The rail used to require "no jog or Frame block"
// for it, and a running jog is such a block, so the arrows greyed out and the
// tap was lost. These tests drive the real store through a fake GRBL
// connection and the real rail, because the pad-level test passes the prop
// itself and could not see the wiring.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, onAck, step, type StreamerState } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { MOTION_OPERATION_ACTIVE_MESSAGE } from '../state/laser-store-helpers';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { outstandingStepJogs } from '../state/step-jog-queue';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = '<Idle|MPos:100.000,100.000,0.000|FS:0,0>';
const JOG = '<Jog|MPos:100.500,100.000,0.000|FS:1000,0>';
const RIGHT = 'Jog +X 10 mm';
const RIGHT_KEY: KeyboardEventInit = {
  key: ']',
  code: 'BracketRight',
  ctrlKey: true,
  altKey: true,
};

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

let writes: string[] = [];
let connection: FakeConnection;
let host: HTMLDivElement;
let root: Root | null = null;

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function jogLines(): string[] {
  return writes.filter((write) => write.startsWith('$J='));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`button "${label}" is missing`);
  return found;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error(`button "${text}" is missing`);
  return found;
}

async function emit(line: string): Promise<void> {
  await act(async () => {
    connection.emitLine(line);
    await drain();
  });
}

async function renderRail(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <LaserWindow />
      </PlatformProvider>,
    );
  });
}

// The first press runs as an ordinary jog; the controller then reports Jog.
async function startStepJog(): Promise<void> {
  await emit(IDLE);
  await act(async () => {
    button(RIGHT).click();
    await drain();
  });
  await emit(JOG);
}

// A tool-change hold whose pre-M0 motion has drained: jogging is allowed there
// to touch off the new bit, but the job still owns the acknowledgements.
function drainedToolChangeStreamer(): StreamerState {
  let state = step(createStreamer('G0 X0\nM0\nG0 Z5', { toolChangePause: true })).state;
  while (state.inFlight.length > 0) state = step(onAck(state, 'ok').state).state;
  return state;
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  writes = [];
  connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
  await renderRail();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    streamer: null,
    toolChangeIdleSeen: false,
    lastWriteError: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LaserWindow keeps the arrows live while a step jog runs (ADR-674)', () => {
  it('queues a second quick tap on the arrow instead of dropping it', async () => {
    await startStepJog();
    expect(jogLines()).toEqual(['$J=G91 G21 X10.000 F3000\n']);
    // The store would take another step; the rail must offer it.
    expect(button(RIGHT).disabled).toBe(false);

    await act(async () => {
      button(RIGHT).click();
      await drain();
    });
    const operation = useLaserStore.getState().motionOperation;
    expect(operation?.pendingLines).toContain('$J=G91 G21 X10.000 F3000\n');
    expect(outstandingStepJogs(operation!)).toBe(2);
    // Held by KerfDesk until the first step settles, not written at once.
    expect(jogLines()).toHaveLength(1);
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('queues an XY jog key the same way', async () => {
    await startStepJog();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { ...RIGHT_KEY, cancelable: true }));
      await drain();
    });
    expect(outstandingStepJogs(useLaserStore.getState().motionOperation!)).toBe(2);
  });

  it('offers single steps only: no hold, and the settings row and Set origin wait', async () => {
    await startStepJog();
    expect(button(RIGHT).title).not.toContain('Hold for continuous jog');
    const speed = host.querySelector<HTMLSelectElement>('select[aria-label="Jog speed"]');
    expect(speed?.disabled).toBe(true);
    const setOrigin = buttonByText('Set origin here');
    expect(setOrigin.disabled).toBe(true);
    // A control that is off says why (A3-P3-4).
    expect(setOrigin.title).toBe(MOTION_OPERATION_ACTIVE_MESSAGE);
  });

  it('greys the arrows again once three steps are owed', async () => {
    await startStepJog();
    for (let press = 0; press < 2; press += 1) {
      await act(async () => {
        button(RIGHT).click();
        await drain();
      });
    }
    expect(outstandingStepJogs(useLaserStore.getState().motionOperation!)).toBe(3);
    expect(button(RIGHT).disabled).toBe(true);
  });

  it('keeps the arrows off for a jog that takes no queue, and says why', async () => {
    await emit(IDLE);
    await act(async () => {
      // No queueStep option: what a press-and-hold or Move to position sends.
      await useLaserStore.getState().jog({ dx: 10, feed: 3000 });
      await drain();
    });
    await emit(JOG);
    expect(button(RIGHT).disabled).toBe(true);
    expect(button(RIGHT).title).toBe(MOTION_OPERATION_ACTIVE_MESSAGE);
  });

  it('gives an enabled arrow its ordinary tooltip', async () => {
    await emit(IDLE);
    expect(button(RIGHT).disabled).toBe(false);
    expect(button(RIGHT).title).toContain('Jog +X 10 mm');
  });

  it('keeps the arrows off while a step jog runs in a tool-change hold', async () => {
    await startStepJog();
    await act(async () => {
      useLaserStore.setState({
        streamer: drainedToolChangeStreamer(),
        toolChangeIdleSeen: true,
      } as Partial<ReturnType<typeof useLaserStore.getState>>);
    });
    expect(button(RIGHT).disabled).toBe(true);
  });
});
