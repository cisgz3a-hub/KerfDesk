import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fluidncDriver } from '../../core/controllers';
import { handleLine } from '../state/laser-line-handler';
import { makeLineHandlerHarness } from '../state/laser-line-handler.test-support';
import { useLaserStore } from '../state/laser-store';
import { ConsolePanel } from './ConsolePanel';
import { SuperConsoleTranscriptList } from './super-console/SuperConsoleTranscriptList';
import {
  filterSuperConsoleEntries,
  formatSuperConsoleTsv,
} from './super-console/super-console-filters';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useLaserStore.getState();
const expectedRows = [
  ['error:161', 'File Download Failed'],
  ['error:172', 'Error 172'],
  ['ALARM:12', 'Ambiguous Switch'],
] as const;

afterEach(() => {
  useLaserStore.setState(initialState);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function receivedTranscript() {
  const { refs, set, get } = makeLineHandlerHarness();
  refs.driver = fluidncDriver;
  set({ activeControllerKind: 'fluidnc', detectedControllerKind: 'grbl-v1.1' });
  for (const [raw] of expectedRows) handleLine(set, get, refs, async () => undefined, raw);
  return get().transcript;
}

describe('FluidNC transcript display surfaces', () => {
  it.each(['clipboard', 'manual'] as const)(
    'keeps the received raw line and configured meaning in rendered rows and %s copy',
    async (mode) => {
      const writeText = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { clipboard: mode === 'clipboard' ? { writeText } : undefined });
      const transcript = receivedTranscript();
      useLaserStore.setState({ transcript });
      const host = document.createElement('div');
      document.body.appendChild(host);
      let root: Root | null = null;
      try {
        await act(async () => {
          root = createRoot(host);
          root.render(
            <>
              <ConsolePanel />
              <SuperConsoleTranscriptList entries={transcript} />
            </>,
          );
        });
        const consoleText = host.querySelector('[aria-label="GRBL console"]')?.textContent;
        for (const [raw, meaning] of expectedRows) {
          expect(consoleText).toContain(raw);
          expect(consoleText).toContain(meaning);
        }
        expect(
          [...host.querySelectorAll('tbody tr')].map((row) => [
            row.children[4]?.textContent,
            row.children[5]?.textContent,
          ]),
        ).toEqual(expectedRows);
        const copy = [...host.querySelectorAll('button')].find(
          (button) => button.textContent === 'Copy visible',
        );
        if (copy === undefined) throw new Error('Copy visible button missing');
        await act(async () => copy.click());
        const expectedCopy =
          'in error error:161 File Download Failed\nin error error:172 Error 172\nin alarm ALARM:12 Ambiguous Switch';
        if (mode === 'clipboard') {
          expect(writeText).toHaveBeenCalledWith(expectedCopy);
        } else {
          expect(host.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toBe(
            expectedCopy,
          );
        }
      } finally {
        if (root !== null) await act(async () => root?.unmount());
        host.remove();
      }
    },
  );

  it('searches and exports the same family meaning while retaining raw fallback', () => {
    const transcript = receivedTranscript();
    const groups = new Set(['errors'] as const);
    for (const [raw, meaning] of expectedRows) {
      const matches = filterSuperConsoleEntries(transcript, { groups, search: meaning });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.raw).toBe(raw);
      expect(formatSuperConsoleTsv(matches)).toContain(`\t${raw}\t${meaning}`);
    }
    expect(filterSuperConsoleEntries(transcript, { groups, search: 'Homing not enabled' })).toEqual(
      [],
    );
    expect(filterSuperConsoleEntries(transcript, { groups, search: 'error:172' })[0]?.decoded).toBe(
      'Error 172',
    );
  });
});
