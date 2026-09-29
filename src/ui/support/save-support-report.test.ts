import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useToastStore } from '../state/toast-store';
import { clearRendererProblems, recordRendererProblem } from './renderer-problems';
import { saveSupportReport } from './save-support-report';

const SAVED_AT = new Date(2026, 8, 29, 7, 12, 30);

afterEach(() => {
  clearRendererProblems();
  useToastStore.setState({ toasts: [] });
});

function platformWith(options: {
  readonly target?: SaveTarget | null;
  readonly pickError?: Error;
  readonly log?: () => Promise<string>;
  readonly id?: PlatformAdapter['id'];
}) {
  const calls: string[] = [];
  const written: string[] = [];
  const target: SaveTarget = options.target ?? {
    displayName: 'kerfdesk-support-report-2026-09-29-0712.txt',
    write: async (data) => {
      calls.push('write');
      written.push(typeof data === 'string' ? data : await data.text());
    },
  };
  const pickFileForSave = vi.fn(async () => {
    calls.push('pick');
    if (options.pickError !== undefined) throw options.pickError;
    return options.target === null ? null : target;
  });
  const readSupportLog =
    options.log === undefined
      ? undefined
      : vi.fn(async () => {
          calls.push('log');
          return options.log?.() ?? '';
        });
  const platform = {
    id: options.id ?? 'electron',
    pickFileForSave,
    ...(readSupportLog === undefined ? {} : { readSupportLog }),
  } as unknown as PlatformAdapter;
  return { platform, pickFileForSave, calls, written };
}

function toasts() {
  return useToastStore.getState().toasts.map(({ message, variant }) => ({ message, variant }));
}

describe('saving a support report', () => {
  it('asks where to save before reading anything, then writes the report', async () => {
    recordRendererProblem('error', new Error('Frame refused'), SAVED_AT.getTime());
    const h = platformWith({ log: async () => 'INFO  [app] KerfDesk started.\n' });

    await saveSupportReport(h.platform, () => SAVED_AT);

    expect(h.pickFileForSave).toHaveBeenCalledExactlyOnceWith({
      suggestedName: 'kerfdesk-support-report-2026-09-29-0712.txt',
      extensions: ['.txt'],
    });
    expect(h.calls).toEqual(['pick', 'log', 'write']);
    const [report] = h.written;
    expect(report).toContain('KerfDesk support report');
    expect(report).toContain('App: desktop app');
    expect(report).toContain('== Machine ==\nProfile: ');
    expect(report).toContain('Connection: disconnected');
    expect(report).toContain('error: Error: Frame refused');
    expect(report).toContain('INFO  [app] KerfDesk started.');
    expect(toasts()).toEqual([
      {
        message:
          'Saved kerfdesk-support-report-2026-09-29-0712.txt. Read it, then email it to support@kerfdesk.com.',
        variant: 'success',
      },
    ]);
  });

  it('does nothing more when the save is cancelled', async () => {
    const h = platformWith({ target: null, log: async () => 'unused' });
    await saveSupportReport(h.platform, () => SAVED_AT);
    expect(h.calls).toEqual(['pick']);
    expect(toasts()).toEqual([]);
  });

  it('says why when the file cannot be saved', async () => {
    const h = platformWith({ pickError: new Error('File System Access API is required.') });
    await saveSupportReport(h.platform, () => SAVED_AT);
    expect(toasts()).toEqual([
      {
        message: 'Could not save the support report: File System Access API is required.',
        variant: 'error',
      },
    ]);
  });

  it('still saves the report when the desktop log cannot be read', async () => {
    const h = platformWith({
      log: async () => {
        throw new Error('The desktop log could not be read (404).');
      },
    });
    await saveSupportReport(h.platform, () => SAVED_AT);
    expect(h.written[0]).toContain('Could not be read: The desktop log could not be read (404).');
    expect(toasts()[0]?.variant).toBe('success');
  });

  it('leaves the desktop log out of a web app report', async () => {
    const h = platformWith({ id: 'web' });
    await saveSupportReport(h.platform, () => SAVED_AT);
    expect(h.written[0]).toContain('App: web app');
    expect(h.written[0]).not.toContain('Desktop log');
  });
});
