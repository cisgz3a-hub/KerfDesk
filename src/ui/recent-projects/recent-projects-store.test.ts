import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentFileAdapter, RecentFileProbe, RecentFileRef } from '../../platform/types';
import { rememberRecentProject } from './recent-project-record';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import {
  configureRecentProjectsForTests,
  reloadRecentProjects,
  useRecentProjectsStore,
} from './recent-projects-store';

const LIMIT_KEY = 'kerfdesk.recent-projects.limit.v1';

type FakeHandle = FileSystemFileHandle & { readonly fileId: string };

function handle(name: string, fileId = name): RecentFileRef {
  return { kind: 'handle', handle: { kind: 'file', name, fileId } as unknown as FakeHandle };
}

function pathRef(path: string): RecentFileRef {
  return { kind: 'desktop-path', path, token: 'c'.repeat(43) };
}

function identity(ref: RecentFileRef): string {
  return ref.kind === 'handle' ? (ref.handle as FakeHandle).fileId : ref.path.toLowerCase();
}

/** Same file when the handles point at the same file id, or the paths match. */
function fakeFiles(probes: Record<string, RecentFileProbe['kind']> = {}): RecentFileAdapter {
  return {
    open: vi.fn(async () => ({ kind: 'missing' as const })),
    probe: vi.fn(async (ref: RecentFileRef): Promise<RecentFileProbe> => {
      const kind = probes[identity(ref)] ?? 'unknown';
      return kind === 'present' ? { kind, size: 1, modifiedMs: 1 } : { kind };
    }),
    isSameFile: vi.fn(async (left: RecentFileRef, right: RecentFileRef) => {
      return left.kind === right.kind && identity(left) === identity(right);
    }),
  };
}

const store = () => useRecentProjectsStore.getState();
const names = () => store().entries.map((entry) => entry.name);

beforeEach(() => {
  localStorage.removeItem(LIMIT_KEY);
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.removeItem(LIMIT_KEY);
  configureRecentProjectsForTests(null);
});

async function recordAt(
  files: RecentFileAdapter,
  name: string,
  ref: RecentFileRef | null,
  at: number,
) {
  vi.setSystemTime(at);
  await store().record(files, { name, ref });
}

describe('Recent Projects store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  it('lists the most recently opened or saved project first', async () => {
    const files = fakeFiles();
    await recordAt(files, 'a.lf2', handle('a.lf2'), 1_000);
    await recordAt(files, 'b.lf2', handle('b.lf2'), 2_000);
    expect(names()).toEqual(['b.lf2', 'a.lf2']);
    expect(store().entries[0]?.lastUsedAt).toBe(2_000);
    expect(store().statuses[store().entries[0]?.id ?? '']).toBe('present');
  });

  it('moves a reopened file to the top instead of listing it twice', async () => {
    const files = fakeFiles();
    await recordAt(files, 'a.lf2', handle('a.lf2', 'file-a'), 1_000);
    await recordAt(files, 'b.lf2', handle('b.lf2'), 2_000);
    // A new handle from a later pick still names the same file.
    await recordAt(files, 'a.lf2', handle('a.lf2', 'file-a'), 3_000);
    expect(names()).toEqual(['a.lf2', 'b.lf2']);
    expect(store().entries[0]?.lastUsedAt).toBe(3_000);
  });

  it('keeps two different files that share a name apart', async () => {
    const files = fakeFiles();
    await recordAt(files, 'sign.lf2', pathRef('C:\\Shop\\sign.lf2'), 1_000);
    await recordAt(files, 'sign.lf2', pathRef('C:\\Home\\sign.lf2'), 2_000);
    expect(store().entries.map((entry) => entry.ref)).toEqual([
      pathRef('C:\\Home\\sign.lf2'),
      pathRef('C:\\Shop\\sign.lf2'),
    ]);
  });

  it('matches a desktop path again without asking about unrelated names', async () => {
    const files = fakeFiles();
    await recordAt(files, 'other.lf2', pathRef('C:\\Shop\\other.lf2'), 1_000);
    await recordAt(files, 'sign.lf2', pathRef('C:\\Shop\\sign.lf2'), 2_000);
    vi.mocked(files.isSameFile).mockClear();
    await recordAt(files, 'Sign.lf2', pathRef('c:\\shop\\SIGN.lf2'), 3_000);
    expect(names()).toEqual(['Sign.lf2', 'other.lf2']);
    expect(files.isSameFile).toHaveBeenCalledTimes(1);
  });

  it('merges a name-only entry with the same name', async () => {
    const files = fakeFiles();
    await recordAt(files, 'old.lf2', null, 1_000);
    await recordAt(files, 'old.lf2', handle('old.lf2'), 2_000);
    expect(store().entries).toHaveLength(1);
    expect(store().entries[0]?.ref).toEqual(handle('old.lf2'));
  });

  it('keeps the chosen number of unpinned projects, plus every pinned one', async () => {
    const files = fakeFiles();
    for (let index = 1; index <= 12; index += 1) {
      await recordAt(files, `p${index}.lf2`, handle(`p${index}.lf2`), index * 1_000);
    }
    expect(store().entries).toHaveLength(10);
    expect(names()).not.toContain('p1.lf2');

    const oldest = store().entries.find((entry) => entry.name === 'p3.lf2');
    await store().setPinned(oldest?.id ?? '', true);
    await store().setLimit(2);
    expect(names()).toEqual(['p3.lf2', 'p12.lf2', 'p11.lf2']);
    expect(store().limit).toBe(2);
    expect(localStorage.getItem(LIMIT_KEY)).toBe('2');

    await store().setLimit(500);
    expect(store().limit).toBe(24);
  });

  it('marks files that are gone as missing and keeps them listed', async () => {
    const files = fakeFiles({ 'file-a': 'missing', 'file-b': 'present' });
    await recordAt(files, 'a.lf2', handle('a.lf2', 'file-a'), 1_000);
    await recordAt(files, 'b.lf2', handle('b.lf2', 'file-b'), 2_000);
    await recordAt(files, 'c.lf2', handle('c.lf2', 'file-c'), 3_000);
    await recordAt(files, 'name-only.lf2', null, 4_000);
    // As after a restart: nothing is known about the files yet.
    useRecentProjectsStore.setState({ statuses: {} });

    await reloadRecentProjects(files);
    const status = (name: string) =>
      store().statuses[store().entries.find((entry) => entry.name === name)?.id ?? ''];
    expect(status('a.lf2')).toBe('missing');
    expect(status('b.lf2')).toBe('present');
    expect(status('c.lf2')).toBeUndefined();
    expect(status('name-only.lf2')).toBeUndefined();
    expect(files.probe).toHaveBeenCalledTimes(3);
    expect(store().entries).toHaveLength(4);
  });

  it('removes one entry, clears the unpinned ones, or clears everything', async () => {
    const files = fakeFiles();
    await recordAt(files, 'a.lf2', handle('a.lf2'), 1_000);
    await recordAt(files, 'b.lf2', handle('b.lf2'), 2_000);
    await recordAt(files, 'c.lf2', handle('c.lf2'), 3_000);
    const [c, b] = store().entries;
    await store().remove(c?.id ?? '');
    expect(names()).toEqual(['b.lf2', 'a.lf2']);
    await store().setPinned(b?.id ?? '', true);
    await store().clearUnpinned();
    expect(names()).toEqual(['b.lf2']);
    await store().clearAll();
    expect(store().entries).toEqual([]);
  });

  it('applies overlapping changes one after another', async () => {
    const files = fakeFiles();
    vi.setSystemTime(1_000);
    await Promise.all([
      store().record(files, { name: 'a.lf2', ref: handle('a.lf2') }),
      store().record(files, { name: 'b.lf2', ref: handle('b.lf2') }),
      store().record(files, { name: 'a.lf2', ref: handle('a.lf2') }),
    ]);
    expect([...names()].sort()).toEqual(['a.lf2', 'b.lf2']);
  });
});

describe('Recent Projects dialog state and recording', () => {
  it('opens with an optional notice and closes without one', () => {
    store().openDialog({ message: 'Gone.', offerPicker: true });
    expect(store()).toMatchObject({
      dialogOpen: true,
      notice: { message: 'Gone.', offerPicker: true },
    });
    store().closeDialog();
    expect(store()).toMatchObject({ dialogOpen: false, notice: null });
  });

  it('records an opened or saved file only where the platform can reopen it', async () => {
    rememberRecentProject({}, { name: 'nowhere.lf2' });
    const files = fakeFiles();
    rememberRecentProject({ recentFiles: files }, { name: 'a.lf2', recentRef: handle('a.lf2') });
    rememberRecentProject({ recentFiles: files }, { name: 'b.lf2' });
    await reloadRecentProjects(files);
    expect([...names()].sort()).toEqual(['a.lf2', 'b.lf2']);
    expect(store().entries.find((entry) => entry.name === 'b.lf2')?.ref).toBeNull();
  });
});
