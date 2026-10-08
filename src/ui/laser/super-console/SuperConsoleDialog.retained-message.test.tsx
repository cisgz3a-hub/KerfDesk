import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_IDLE,
  beginCaptureTest,
  captureConsoleRaw,
  captureController,
  connectCaptureController,
  endCaptureTest,
  renderCaptureConsole,
} from '../../../__fixtures__/controller-incident-capture';
import { incidentHistory, seedIncidentHistory } from '../../../__fixtures__/controller-incidents';
import { LINE_ERROR_NOTICE_INTERVAL_MS } from '../../state/laser-serial-line-errors';
import { useLaserStore } from '../../state/laser-store';
import { TRANSCRIPT_MAX, type SerialTranscriptEntry } from '../../state/laser-transcript';

beforeEach(beginCaptureTest);
afterEach(endCaptureTest);

type Capture = ReturnType<typeof captureController>;

async function connectedController(): Promise<Capture> {
  const controller = captureController({ statusReply: () => CAPTURE_IDLE });
  await connectCaptureController(controller.connection);
  useLaserStore.getState().clearTranscript();
  return controller;
}

function uartEntry(controller: Capture, name: 'FramingError' | 'ParityError') {
  controller.emitLineError(name);
  const entry = useLaserStore
    .getState()
    .transcript.filter((item) => item.raw.includes(`Serial line error (${name})`))
    .at(-1);
  expect(entry).toMatchObject({ kind: 'message', direction: 'system', source: 'system' });
  if (entry === undefined) throw new Error('The actual UART diagnostic was not published.');
  return entry;
}

function retainForUi(entries: ReadonlyArray<SerialTranscriptEntry>): void {
  const history = incidentHistory();
  // Preserve actual retained entries when capture exists, including any future
  // event metadata. A raw copy otherwise isolates the UI from the capture defect.
  seedIncidentHistory(
    entries.map((entry) => history.find((item) => item.id === entry.id) ?? entry),
  );
}

async function selectOnly(group: 'Errors' | 'Replies'): Promise<void> {
  for (const label of ['Errors', 'Commands', 'Replies', 'Status', 'Stream']) {
    const input = [...document.body.querySelectorAll('label')]
      .find((candidate) => candidate.textContent === label)
      ?.querySelector('input');
    expect(input).toBeDefined();
    if (input?.checked !== (label === group)) await act(async () => input?.click());
  }
}

function diagnosticRows(raw: string): HTMLTableRowElement[] {
  return [
    ...document.body.querySelectorAll<HTMLTableRowElement>(
      '[aria-label="Super console transcript"] tbody > tr',
    ),
  ].filter((row) => row.querySelectorAll('td')[4]?.textContent === raw);
}

describe('D1 retained diagnostics preserve their message kind in Errors', () => {
  it.each(['FramingError', 'ParityError'] as const)(
    'shows a retained live UART %s once when only Errors is selected',
    async (name) => {
      const controller = await connectedController();
      const entry = uartEntry(controller, name);
      retainForUi([entry]);
      await renderCaptureConsole();
      expect(captureConsoleRaw()).toEqual([entry.raw]);

      await selectOnly('Errors');

      expect(captureConsoleRaw()).toEqual([entry.raw]);
      expect(diagnosticRows(entry.raw)[0]?.querySelectorAll('td')[3]?.textContent).toBe('message');
      expect(diagnosticRows(entry.raw)[0]?.querySelector('td')?.title).toBe(
        new Date(entry.at).toISOString(),
      );
      expect(entry.kind).toBe('message');
    },
  );

  it.each(['FramingError', 'ParityError'] as const)(
    'shows a retained UART %s in Errors after actual ACKs evict its raw transcript row',
    async (name) => {
      const controller = await connectedController();
      const entry = uartEntry(controller, name);
      retainForUi([entry]);
      for (let index = 0; index < TRANSCRIPT_MAX; index += 1) controller.connection.emitLine('ok');
      expect(useLaserStore.getState().transcript).toHaveLength(TRANSCRIPT_MAX);
      expect(useLaserStore.getState().transcript.some((item) => item.id === entry.id)).toBe(false);
      expect(incidentHistory().some((item) => item.id === entry.id)).toBe(true);
      await renderCaptureConsole();

      await selectOnly('Errors');

      expect(captureConsoleRaw()).toEqual([entry.raw]);
      expect(diagnosticRows(entry.raw)[0]?.querySelectorAll('td')[3]?.textContent).toBe('message');
      expect(diagnosticRows(entry.raw)[0]?.querySelector('td')?.title).toBe(
        new Date(entry.at).toISOString(),
      );
    },
  );

  it('deduplicates retained/live copies by ID while preserving two distinct UART incidents with identical text', async () => {
    const controller = await connectedController();
    const first = uartEntry(controller, 'FramingError');
    vi.setSystemTime(first.at + LINE_ERROR_NOTICE_INTERVAL_MS);
    const second = uartEntry(controller, 'FramingError');
    expect(second.id).toBeGreaterThan(first.id);
    expect(second.raw).toBe(first.raw);
    retainForUi([first, second]);
    await renderCaptureConsole();
    expect(captureConsoleRaw()).toEqual([first.raw, second.raw]);

    await selectOnly('Errors');

    expect(captureConsoleRaw()).toEqual([first.raw, second.raw]);
    expect(diagnosticRows(first.raw).map((row) => row.querySelector('td')?.title)).toEqual(
      [first, second].map((entry) => new Date(entry.at).toISOString()),
    );
    expect(
      diagnosticRows(first.raw).map((row) => row.querySelectorAll('td')[3]?.textContent),
    ).toEqual(['message', 'message']);
  });

  it('control: an ordinary unarchived Ready message remains under Replies and is absent from Errors', async () => {
    const controller = await connectedController();
    controller.connection.emitLine('[MSG:Ready]');
    const ready = useLaserStore.getState().transcript.find((entry) => entry.raw === '[MSG:Ready]');
    expect(ready?.kind).toBe('message');
    expect(incidentHistory().some((entry) => entry.id === ready?.id)).toBe(false);
    await renderCaptureConsole();
    await selectOnly('Replies');
    expect(captureConsoleRaw()).toEqual(['[MSG:Ready]']);
    await selectOnly('Errors');
    expect(captureConsoleRaw()).toEqual([]);
  });
});
