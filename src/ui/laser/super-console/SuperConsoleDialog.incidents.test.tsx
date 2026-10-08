import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCIDENT_AT,
  SAFETY_NOTICE,
  incidentEntry,
  incidentHistory,
  resetIncidentState,
  seedIncidentHistory,
} from '../../../__fixtures__/controller-incidents';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useLaserStore } from '../../state/laser-store';
import { inboundTranscriptEntry } from '../../state/laser-transcript';
import { SuperConsoleDialog } from './SuperConsoleDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};
const alarm = incidentEntry(1, { raw: 'ALARM:2', decoded: 'Retained alarm diagnosis' });
const error = {
  ...inboundTranscriptEntry(2, INCIDENT_AT + 2, 'error:20'),
  decoded: 'Retained error diagnosis',
};
const blocked = incidentEntry(3, {
  kind: 'blocked',
  direction: 'system',
  source: 'system',
  raw: 'Connect before sending a command.',
});
const disconnected = incidentEntry(4, {
  kind: 'disconnect',
  direction: 'system',
  source: 'system',
  raw: 'USB connection lost.',
});
const ack = inboundTranscriptEntry(5, INCIDENT_AT + 5, 'ok');

const mounted: Array<{ readonly root: Root; readonly host: HTMLDivElement }> = [];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => resetIncidentState());
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  resetIncidentState();
  vi.restoreAllMocks();
  if (originalClipboard === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', originalClipboard);
  document.body.innerHTML = '';
});

async function renderDialog(): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () =>
    root.render(
      <PlatformProvider adapter={platform}>
        <SuperConsoleDialog onClose={() => undefined} />
      </PlatformProvider>,
    ),
  );
}

function rows(): HTMLTableRowElement[] {
  return [
    ...document.body.querySelectorAll<HTMLTableRowElement>(
      '[aria-label="Super console transcript"] tbody > tr',
    ),
  ].filter((row) => row.querySelectorAll('td').length === 6);
}
function visibleRaw(): string[] {
  return rows().map((row) => row.querySelectorAll('td')[4]?.textContent ?? '');
}
function button(label: RegExp): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((candidate) =>
    label.test(candidate.textContent ?? ''),
  );
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`${label} button missing`);
  return found;
}
async function search(value: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Search console lines"]',
  );
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function errorsOnly(): Promise<void> {
  for (const name of ['Commands', 'Replies', 'Status', 'Stream']) {
    const input = [...document.body.querySelectorAll('label')]
      .find((label) => label.textContent === name)
      ?.querySelector('input');
    expect(input).toBeDefined();
    await act(async () => input?.click());
  }
}
function clipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

describe('D1 Super Console retained incidents', () => {
  it('merges rolling lines and retained incidents chronologically, deduplicated by ID', async () => {
    seedIncidentHistory([error, alarm], { transcript: [error, ack] });
    await renderDialog();
    expect(visibleRaw()).toEqual([alarm.raw, error.raw, ack.raw]);
    expect(rows().map((row) => row.querySelector('td')?.title)).toEqual(
      [alarm, error, ack].map((entry) => new Date(entry.at).toISOString()),
    );
    expect(document.body.textContent).toContain('3 of 3 lines');
  });

  it('Errors shows retained alarms, errors, blocked commands, and disconnect incidents', async () => {
    seedIncidentHistory([alarm, error, blocked, disconnected], { transcript: [error, ack] });
    await renderDialog();
    await errorsOnly();
    expect(visibleRaw()).toEqual([alarm.raw, error.raw, blocked.raw, disconnected.raw]);
  });

  it.each([
    { search: 'ALARM:2', label: 'raw text' },
    { search: 'Retained alarm diagnosis', label: 'decoded meaning' },
    { search: new Date(alarm.at).toISOString(), label: 'original timestamp' },
  ])('searches a retained incident by $label', async (query) => {
    seedIncidentHistory([alarm], { transcript: [ack] });
    await renderDialog();
    await search(query.search);
    expect(visibleRaw()).toEqual([alarm.raw]);
  });

  it('copies merged incidents exactly once with their original timestamps', async () => {
    seedIncidentHistory([alarm, error], { transcript: [error, ack] });
    const writeText = vi.fn(async (_text: string) => undefined);
    clipboard(writeText);
    await renderDialog();
    await act(async () => button(/^Copy visible$/).click());
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain(
      `${new Date(alarm.at).toISOString()}\tin\tcontroller\talarm\tALARM:2\tRetained alarm diagnosis`,
    );
    expect(copied.split('\n').filter((line) => line.includes('\terror:20\t'))).toHaveLength(1);
    expect(copied.split('\n')).toHaveLength(4);
  });

  it('copy respects the Errors and search filters after merging incident history', async () => {
    seedIncidentHistory([alarm, error, disconnected], { transcript: [error, ack] });
    const writeText = vi.fn(async (_text: string) => undefined);
    clipboard(writeText);
    await renderDialog();
    await errorsOnly();
    await search('USB connection lost');
    await act(async () => button(/^Copy visible$/).click());
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]?.[0] ?? '';
    expect(copied).toContain(new Date(disconnected.at).toISOString());
    expect(copied).toContain('USB connection lost.');
    expect(copied).not.toContain('ALARM:2');
    expect(copied).not.toContain('error:20');
    expect(copied.split('\n')).toHaveLength(2);
  });

  it('manual-copy fallback includes retained incident cells with escaped separators', async () => {
    const escaped = incidentEntry(1, {
      raw: 'ALARM:2\tport',
      decoded: 'Meaning line one\nline two',
    });
    seedIncidentHistory([escaped], { transcript: [ack] });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await renderDialog();
    await act(async () => button(/^Copy visible$/).click());
    const manual = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Super console transcript to copy manually"]',
    );
    expect(manual?.value).toContain(new Date(escaped.at).toISOString());
    expect(manual?.value).toContain('ALARM:2\\tport');
    expect(manual?.value).toContain('Meaning line one\\nline two');
    expect(manual?.value.split('\n')).toHaveLength(3);
  });

  it('subscribes to retained incidents even after the rolling console is cleared', async () => {
    seedIncidentHistory([alarm], { transcript: [ack] });
    await renderDialog();
    await act(async () => useLaserStore.getState().clearTranscript());
    expect(useLaserStore.getState().transcript).toEqual([]);
    expect(visibleRaw()).toEqual([alarm.raw]);
  });

  it('provides an explicit incident-history clear without acknowledging SafetyNotice', async () => {
    seedIncidentHistory([alarm], { safetyNotice: SAFETY_NOTICE });
    await renderDialog();
    await act(async () => button(/clear.*incident/i).click());
    expect(incidentHistory()).toEqual([]);
    expect(visibleRaw()).toEqual([]);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
  });

  it('keeps ordinary rolling lines filterable and copyable when incident history is empty', async () => {
    seedIncidentHistory([], { transcript: [error, ack] });
    const writeText = vi.fn(async (_text: string) => undefined);
    clipboard(writeText);
    await renderDialog();
    await errorsOnly();
    await act(async () => button(/^Copy visible$/).click());
    expect(visibleRaw()).toEqual([error.raw]);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain('error:20');
    expect(writeText.mock.calls[0]?.[0]).not.toContain('\tok\t');
  });
});
