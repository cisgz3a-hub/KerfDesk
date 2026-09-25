import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, RecentFileProbe, RecentFileRef } from '../../platform/types';
import { mockPlatform } from '../../__fixtures__/file-actions';
import type { RecentProjectEntry } from './recent-project-model';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';
import { RecentProjectsDialog } from './RecentProjectsDialog';

const LIMIT_KEY = 'kerfdesk.recent-projects.limit.v1';

function pathRef(path: string): RecentFileRef {
  return { kind: 'desktop-path', path, token: 'f'.repeat(43) };
}

function entry(id: string, lastUsedAt: number, extra: Partial<RecentProjectEntry> = {}) {
  return {
    id,
    name: `${id}.lf2`,
    ref: pathRef(`C:\\Jobs\\${id}.lf2`),
    pinned: false,
    lastUsedAt,
    ...extra,
  };
}

function platform(missing: ReadonlyArray<string> = []): PlatformAdapter {
  return {
    ...mockPlatform(),
    pickFilesForOpen: vi.fn(async () => []),
    recentFiles: {
      open: vi.fn(async () => ({ kind: 'missing' as const })),
      probe: vi.fn(async (ref: RecentFileRef): Promise<RecentFileProbe> => {
        const gone = ref.kind === 'desktop-path' && missing.some((id) => ref.path.includes(id));
        return gone ? { kind: 'missing' } : { kind: 'present', size: 1, modifiedMs: 1 };
      }),
      isSameFile: async () => false,
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.removeItem(LIMIT_KEY);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  configureRecentProjectsForTests(null);
  localStorage.removeItem(LIMIT_KEY);
  vi.unstubAllGlobals();
});

async function show(entries: ReadonlyArray<RecentProjectEntry>, adapter = platform()) {
  configureRecentProjectsForTests(createMemoryRecentProjectStorage(entries));
  useRecentProjectsStore.getState().openDialog();
  await act(async () => root.render(<RecentProjectsDialog platform={adapter} />));
  await act(async () => undefined);
  return adapter;
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[data-recent-project]')];
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`No ${label} button`);
  return found;
}

function row(id: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-recent-project="${id}"]`);
  if (found === null) throw new Error(`No row ${id}`);
  return found;
}

describe('Recent Projects manager', () => {
  it('explains an empty list', async () => {
    await show([]);
    expect(host.textContent).toContain('No recent projects yet.');
    expect(button(host, 'Clear unpinned').disabled).toBe(true);
    expect(button(host, 'Clear all').disabled).toBe(true);
  });

  it('lists pinned projects first with their folder and when they were last used', async () => {
    await show([
      entry('older', 1_000),
      entry('newer', 2_000),
      entry('pinned', 500, { pinned: true }),
    ]);

    expect(rows().map((item) => item.dataset['recentProject'])).toEqual([
      'pinned',
      'newer',
      'older',
    ]);
    expect(row('pinned').textContent).toContain('Pinned');
    expect(row('newer').textContent).toContain('C:\\Jobs');
    expect(row('newer').textContent).toContain('Opened or saved');
  });

  it('marks a project whose file is gone and lets the operator remove it', async () => {
    await show([entry('here', 2_000), entry('gone', 1_000)], platform(['gone']));

    expect(row('gone').textContent).toContain('Missing');
    expect(row('here').textContent).not.toContain('Missing');
    await act(async () => button(row('gone'), 'Remove').click());
    expect(rows().map((item) => item.dataset['recentProject'])).toEqual(['here']);
  });

  it('pins and unpins a project', async () => {
    await show([entry('a', 2_000), entry('b', 1_000)]);

    await act(async () => button(row('b'), 'Pin').click());
    expect(rows()[0]?.dataset['recentProject']).toBe('b');
    await act(async () => button(row('b'), 'Unpin').click());
    expect(rows()[0]?.dataset['recentProject']).toBe('a');
  });

  it('clears the unpinned projects, or all of them', async () => {
    await show([entry('a', 2_000), entry('b', 1_000, { pinned: true })]);

    await act(async () => button(host, 'Clear unpinned').click());
    expect(rows().map((item) => item.dataset['recentProject'])).toEqual(['b']);
    await act(async () => button(host, 'Clear all').click());
    expect(rows()).toEqual([]);
  });

  it('sets how many projects to keep, within 1 to 24', async () => {
    await show([entry('a', 2_000), entry('b', 1_000)]);
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Recent projects to keep"]',
    );
    if (input === null) throw new Error('No limit field');
    expect(input.value).toBe('10');

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(input, '99');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(useRecentProjectsStore.getState().limit).toBe(24);
    expect(input.value).toBe('24');
    expect(localStorage.getItem(LIMIT_KEY)).toBe('24');

    await act(async () => {
      setValue?.call(input, '1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(useRecentProjectsStore.getState().limit).toBe(1);
    expect(rows()).toHaveLength(1);
  });

  it('closes to reopen the chosen project', async () => {
    const adapter = platform();
    vi.mocked(adapter.recentFiles!.open).mockResolvedValue({ kind: 'failed', message: 'busy.' });
    await show([entry('a', 2_000)], adapter);

    await act(async () => button(row('a'), 'Open').click());
    expect(adapter.recentFiles?.open).toHaveBeenCalledWith(pathRef('C:\\Jobs\\a.lf2'));
    expect(useRecentProjectsStore.getState().dialogOpen).toBe(false);
  });

  it('comes back with the reason when the chosen file is gone', async () => {
    await show([entry('a', 2_000)]);

    await act(async () => button(row('a'), 'Open').click());
    const state = useRecentProjectsStore.getState();
    expect(state.dialogOpen).toBe(true);
    expect(state.notice?.message).toContain('a.lf2 is no longer in C:\\Jobs');
    expect(row('a').textContent).toContain('Missing');
  });

  it('offers the file picker next to a problem notice', async () => {
    configureRecentProjectsForTests(createMemoryRecentProjectStorage([entry('a', 1)]));
    useRecentProjectsStore.getState().openDialog({ message: 'a.lf2 is gone.', offerPicker: true });
    const adapter = platform();
    await act(async () => root.render(<RecentProjectsDialog platform={adapter} />));

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('a.lf2 is gone.');
    await act(async () => button(host, 'Choose file...').click());
    expect(useRecentProjectsStore.getState().dialogOpen).toBe(false);
    expect(adapter.pickFilesForOpen).toHaveBeenCalledOnce();
  });
});
