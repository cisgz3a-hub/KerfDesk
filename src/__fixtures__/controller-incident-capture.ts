import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection, SerialPortRef } from '../platform/types';
import { PlatformProvider } from '../ui/app/platform-context';
import { SuperConsoleDialog } from '../ui/laser/super-console/SuperConsoleDialog';
import { disconnectOnTestClock } from '../ui/state/laser-disconnect-testing';
import { useLaserStore } from '../ui/state/laser-store';
import {
  flushConnect,
  makeConnection,
  type FakeConnection,
} from '../ui/state/laser-store-console.test-support';
import { settleTestGrblHandshake } from '../ui/state/laser-test-start-helpers';
import { useToastStore } from '../ui/state/toast-store';
import {
  INCIDENT_AT,
  incidentHistory,
  resetIncidentState,
  type IncidentState,
} from './controller-incidents';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export const CAPTURE_IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
export const CAPTURE_RUN = '<Run|MPos:1.000,0.000,0.000|FS:1000,100>';
export const CAPTURE_PROGRAM = [
  'G21',
  'G90',
  'M4 S0',
  ...Array.from({ length: 30 }, (_, index) => `G1 X${index} S100`),
  'M5',
].join('\n');

type CaptureControllerOptions = {
  readonly write?: (data: string) => Promise<void>;
  readonly statusReply?: () => string | null;
};

/** Only deterministic fake transports; spontaneous replies belong to each test. */
export function captureController(options: CaptureControllerOptions = {}) {
  const writes: string[] = [];
  const errors = new Set<(name: string) => void>();
  const closes = new Set<() => void>();
  const retiredErrors: Array<(name: string) => void> = [];
  let closeCount = 0;
  const base = makeConnection(
    async (data) => {
      writes.push(data);
      await options.write?.(data);
      const status = data === '?' ? (options.statusReply?.() ?? null) : null;
      if (status !== null) queueMicrotask(() => connection.emitLine(status));
      if (data === '\x18') queueMicrotask(() => connection.emitLine('Grbl 1.1f'));
    },
    { autoAckStartFence: true },
  );
  const connection: FakeConnection = {
    ...base,
    onLineError: (handler) => {
      errors.add(handler);
      retiredErrors.push(handler);
      return () => errors.delete(handler);
    },
    onClose: (handler) => {
      closes.add(handler);
      return () => closes.delete(handler);
    },
    close: async () => {
      closeCount += 1;
    },
  };
  return {
    connection,
    writes,
    retiredErrors,
    closeCount: () => closeCount,
    emitLineError: (name: string) => errors.forEach((handler) => handler(name)),
    emitClose: () => [...closes].forEach((handler) => handler()),
  };
}

export function captureAdapter(requestPort: () => Promise<SerialPortRef | null>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort },
  };
}

export const adapterForCapture = (connection: SerialConnection): PlatformAdapter =>
  captureAdapter(async () => ({ open: async () => connection }));

export async function connectCaptureController(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterForCapture(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine(CAPTURE_IDLE);
  await flushConnect();
  for (const line of ['$13=0', '$30=1000', '$32=1', 'ok']) connection.emitLine(line);
  await settleTestGrblHandshake();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
}

const views = new Set<{ readonly host: HTMLDivElement; readonly root: Root }>();

export async function renderCaptureConsole(): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.add({ host, root });
  await act(async () =>
    root.render(
      createElement(PlatformProvider, {
        adapter: captureAdapter(async () => null),
        children: createElement(SuperConsoleDialog, { onClose: () => undefined }),
      }),
    ),
  );
}

export function captureConsoleRaw(): string[] {
  return [
    ...document.body.querySelectorAll<HTMLTableRowElement>(
      '[aria-label="Super console transcript"] tbody > tr',
    ),
  ]
    .filter((row) => row.querySelectorAll('td').length === 6)
    .map((row) => row.querySelectorAll('td')[4]?.textContent ?? '');
}

export function clearCapturedIncidents(): void {
  const clear = (useLaserStore.getState() as IncidentState).clearIncidentHistory;
  expect.soft(clear).toBeTypeOf('function');
  clear?.();
}

export function retainedCapture(reason: RegExp) {
  return incidentHistory().filter((entry) => reason.test(`${entry.raw}\n${entry.decoded ?? ''}`));
}

export async function beginCaptureTest(): Promise<void> {
  vi.useFakeTimers();
  vi.setSystemTime(INCIDENT_AT);
  await disconnectOnTestClock();
  resetIncidentState();
  useToastStore.setState({ toasts: [] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

export async function endCaptureTest(): Promise<void> {
  for (const view of views) {
    await act(async () => view.root.unmount());
    view.host.remove();
  }
  views.clear();
  await disconnectOnTestClock();
  resetIncidentState();
  useToastStore.setState({ toasts: [] });
  vi.useRealTimers();
  vi.restoreAllMocks();
}
