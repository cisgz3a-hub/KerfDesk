// The Moshi USB store (ADR-705) end to end through the shared USB foundation
// (ADR-702): the real opener, the real CH341 EPP driver and its framing, the
// fake USB device, and the scripted Moshiboard behind it. Start → Abort, the
// Frame staying laser-off, an unplug, and the open failures. Simulator only.
import { afterEach, describe, expect, it } from 'vitest';
import { MoshiSimulator } from '../../../__fixtures__/controllers/moshi-simulator';
import { createMoshiUsbSimulator } from '../../../__fixtures__/controllers/moshi-usb-simulator';
import { encodeMoshiJob } from '../../../core/controllers/moshi';
import {
  MOSHI_ESTOP_BYTE,
  MOSHI_PROLOGUE_BYTE,
} from '../../../core/controllers/moshi/moshi-live-commands';
import { CH341_USB_FILTER } from '../../../core/controllers/usb/ch341-epp';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { Job } from '../../../core/job';
import {
  UsbLinkOpenError,
  type UsbLinkAdapter,
  type UsbLinkSession,
} from '../../../platform/usb-link-types';
import { MOSHI_NO_DEVICE_CHOSEN, moshiUsbOpener } from './moshi-usb-link';
import { resetMoshiUsbStoreForTests, useMoshiUsbStore } from './moshi-usb-store';
import type { MoshiUsbJob } from './moshi-usb-types';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#f00',
      power: 60,
      speed: 1200,
      passes: 12,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 50, y: 10 },
            { x: 50, y: 30 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function compiled(): MoshiUsbJob {
  const result = encodeMoshiJob(JOB, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'moshi' });
  if (!result.ok) throw new Error(result.error.kind);
  return {
    programs: result.programs.map((program) => program.bytes),
    footprint: result.footprint,
    advisories: [],
    framingFeedMmPerMin: 3000,
  };
}

function adapter(session: UsbLinkSession | null, requests: unknown[] = []): UsbLinkAdapter {
  return {
    request: async (filters) => {
      requests.push(filters);
      return session;
    },
    reopen: async () => session,
  };
}

const noWait = { wait: async () => undefined };

afterEach(() => resetMoshiUsbStoreForTests());

describe('Moshi USB store over the fake USB device', () => {
  it('opens the CH341 with control-transfer status and runs Frame then Start', async () => {
    const board = new MoshiSimulator();
    const usb = createMoshiUsbSimulator(board);
    const requests: unknown[] = [];
    const store = useMoshiUsbStore;
    await store.getState().connect(moshiUsbOpener(adapter(usb.session, requests)), noWait);
    expect(requests).toEqual([[CH341_USB_FILTER]]);
    expect(store.getState().device).toBe('CH341 chip version 48');
    // Moshi reads status by vendor control transfer (request 0x52), never bulk A0.
    expect(
      usb.calls.some((call) => call.kind === 'control-in' && call.setup.request === 0x52),
    ).toBe(true);
    expect(usb.writes().some((bytes) => bytes[0] === 0xa0)).toBe(false);

    await store.getState().frame(compiled());
    expect(board.runs[0]?.program.steps.every((step) => !step.cut)).toBe(true);
    await store.getState().start(compiled());
    expect(store.getState().message).toContain('Job finished');
    expect(board.runs).toHaveLength(2);
    expect(board.cuts()).toHaveLength(24);
    expect(board.decodeErrors).toEqual([]);
    expect(usb.unframed).toEqual([]);
    // The prologue went out as an EPP address write: A7 then the byte.
    expect(
      usb.writes().some((bytes) => bytes[0] === 0xa7 && bytes[1] === MOSHI_PROLOGUE_BYTE),
    ).toBe(true);
  });

  it('Abort mid-run sends the estop over USB and no program data after it', async () => {
    let aborting: Promise<void> | null = null;
    const board = new MoshiSimulator({
      onData: () => {
        if (useMoshiUsbStore.getState().phase === 'running' && aborting === null)
          aborting = useMoshiUsbStore.getState().abort();
      },
    });
    const usb = createMoshiUsbSimulator(board);
    const store = useMoshiUsbStore;
    await store.getState().connect(moshiUsbOpener(adapter(usb.session)), noWait);
    await store.getState().frame(compiled());
    await store.getState().start(compiled());
    await aborting;
    const writes = usb.writes();
    const estopAt = writes.findIndex((bytes) => bytes[0] === 0xa7 && bytes[1] === MOSHI_ESTOP_BYTE);
    expect(estopAt).toBeGreaterThan(0);
    expect(writes.slice(estopAt + 1).some((bytes) => bytes[0] === 0xa6)).toBe(false);
    expect(board.cuts()).toEqual([]);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().framed).toBeNull();
  });

  it('an unplug during a run disconnects and warns', async () => {
    let unplug: (() => void) | null = null;
    const board = new MoshiSimulator({ onData: () => unplug?.() });
    const usb = createMoshiUsbSimulator(board);
    unplug = usb.unplug;
    await useMoshiUsbStore.getState().connect(moshiUsbOpener(adapter(usb.session)), noWait);
    await useMoshiUsbStore.getState().frame(compiled());
    expect(useMoshiUsbStore.getState().phase).toBe('disconnected');
    expect(useMoshiUsbStore.getState().message).toContain('may still be running');
  });

  it('says why nothing opened: no device chosen, or no WinUSB driver', async () => {
    await useMoshiUsbStore.getState().connect(moshiUsbOpener(adapter(null)), noWait);
    expect(useMoshiUsbStore.getState().message).toBe(MOSHI_NO_DEVICE_CHOSEN);
    const failing: UsbLinkAdapter = {
      request: async () => {
        throw new UsbLinkOpenError('driver', 'Access denied');
      },
      reopen: async () => null,
    };
    await useMoshiUsbStore.getState().connect(moshiUsbOpener(failing), noWait);
    expect(useMoshiUsbStore.getState().phase).toBe('disconnected');
    expect(useMoshiUsbStore.getState().message).toContain('WinUSB');
  });
});
