import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, RecentFileProbe, RecentFileRef } from '../../platform/types';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { PlatformProvider } from '../app/platform-context';
import { AppMenuBar } from '../commands/AppMenuBar';
import { buildAppCommands } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import type { RecentProjectEntry } from './recent-project-model';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';

function pathRef(id: string): RecentFileRef {
  return { kind: 'desktop-path', path: `C:\\Jobs\\${id}.lf2`, token: 'g'.repeat(43) };
}

function entry(id: string, lastUsedAt: number, extra: Partial<RecentProjectEntry> = {}) {
  return { id, name: `${id}.lf2`, ref: pathRef(id), pinned: false, lastUsedAt, ...extra };
}

function platform(): PlatformAdapter {
  return {
    ...mockPlatform(),
    recentFiles: {
      open: vi.fn(async () => ({ kind: 'failed' as const, message: 'busy.' })),
      probe: vi.fn(
        async (ref: RecentFileRef): Promise<RecentFileProbe> =>
          ref.kind === 'desktop-path' && ref.path.includes('gone')
            ? { kind: 'missing' }
            : { kind: 'unknown' },
      ),
      isSameFile: async () => false,
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  configureRecentProjectsForTests(null);
  vi.unstubAllGlobals();
});

async function openFileMenu(adapter: PlatformAdapter | null): Promise<HTMLElement> {
  const menu = <AppMenuBar commands={buildAppCommands(baseCtx())} machineKind="laser" />;
  await act(async () =>
    root.render(
      adapter === null ? menu : <PlatformProvider adapter={adapter}>{menu}</PlatformProvider>,
    ),
  );
  const summary = host.querySelector<HTMLElement>('[data-menu-family-summary="file"]');
  await act(async () => summary?.click());
  await act(async () => undefined);
  const list = host.querySelector<HTMLElement>('[data-family-menu="file"]');
  if (list === null) throw new Error('File menu did not open');
  return list;
}

function recentItems(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('button[data-recent-project]')];
}

describe('recent projects in the File menu', () => {
  it('lists recent projects after the File commands, pinned first, and marks missing files', async () => {
    configureRecentProjectsForTests(
      createMemoryRecentProjectStorage([
        entry('older', 1_000),
        entry('gone', 3_000),
        entry('pinned', 500, { pinned: true }),
      ]),
    );
    const menu = await openFileMenu(platform());

    const group = menu.querySelector('[role="group"][aria-label="Recent projects"]');
    expect(group?.textContent).toContain('Recent projects');
    expect(recentItems(menu).map((item) => item.textContent)).toEqual([
      'pinned.lf2pinned',
      'gone.lf2missing',
      'older.lf2',
    ]);
    const items = [...menu.querySelectorAll('button[role="menuitem"]')];
    expect(items.indexOf(recentItems(menu)[0]!)).toBeGreaterThan(
      items.findIndex((item) => item.textContent?.includes('Recent Projects...')),
    );
    expect(recentItems(menu)[2]?.title).toBe('Open older.lf2 from C:\\Jobs.');
  });

  it('reopens a project in one click and closes the menu', async () => {
    configureRecentProjectsForTests(createMemoryRecentProjectStorage([entry('coaster', 1_000)]));
    const adapter = platform();
    const menu = await openFileMenu(adapter);

    await act(async () => recentItems(menu)[0]?.click());
    expect(adapter.recentFiles?.open).toHaveBeenCalledWith(pathRef('coaster'));
    expect(host.querySelector('[data-family-menu="file"]')).toBeNull();
  });

  it('reaches the recent projects with the arrow keys like any other item', async () => {
    configureRecentProjectsForTests(createMemoryRecentProjectStorage([entry('coaster', 1_000)]));
    const menu = await openFileMenu(platform());
    const first = menu.querySelector<HTMLButtonElement>('button[role="menuitem"]');
    first?.focus();

    await act(async () => {
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(document.activeElement).toBe(recentItems(menu)[0]);
  });

  it('shows nothing extra while the list is empty or no file access exists', async () => {
    configureRecentProjectsForTests(createMemoryRecentProjectStorage([]));
    expect(recentItems(await openFileMenu(platform()))).toEqual([]);

    await act(async () => root.unmount());
    root = createRoot(host);
    configureRecentProjectsForTests(createMemoryRecentProjectStorage([entry('a', 1)]));
    await useRecentProjectsStore.getState().refresh();
    expect(recentItems(await openFileMenu(null))).toEqual([]);
  });
});
