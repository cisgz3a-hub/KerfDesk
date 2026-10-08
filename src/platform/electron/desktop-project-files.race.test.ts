import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import type { PlatformAdapter } from '../types';
import { webAdapter } from '../web/web-adapter';
import { useStore } from '../../ui/state';
import { resetStore } from '../../ui/state/test-helpers';
import { handleSaveProject, type SaveProjectCtx } from '../../ui/app/project-save-action';
import { checkDesktopProjectPath } from '../../../electron/desktop-project-file-check';
import { saveDesktopProjectFile } from '../../../electron/desktop-project-save';
import { createDesktopProjectFiles } from './desktop-project-files';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function context(platform: PlatformAdapter): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform,
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    pushToast: vi.fn(),
  };
}

function savedNote(data: string): string {
  const result = deserializeProject(data);
  if (result.kind !== 'ok') throw new Error(`Invalid saved fixture: ${result.kind}`);
  return result.project.notes;
}

const pickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});
afterEach(() => {
  if (pickerDescriptor) Object.defineProperty(window, 'showSaveFilePicker', pickerDescriptor);
  else Reflect.deleteProperty(window, 'showSaveFilePicker');
  vi.restoreAllMocks();
  resetStore();
});

it('restores newer native-handle bytes after the same desktop-path Save finishes late', async () => {
  const gate = deferred();
  const started = deferred();
  let disk = '';
  const files = createDesktopProjectFiles(undefined, {
    events: new EventTarget(),
    fetchRoute: async (_url, init) => {
      started.resolve();
      await gate.promise;
      disk = String(init.body);
      return new Response(null, { status: 204 });
    },
  });
  const retained = files.openedProjectSaveTarget({
    kind: 'desktop-path',
    path: 'D:\\Jobs\\shared.lf2',
    token: 'a'.repeat(43),
  });
  if (!retained) throw new Error('Expected opened Save target');
  const handle = {
    kind: 'file',
    name: 'shared.lf2',
    isSameEntry: async (other: unknown) => other === handle,
    createWritable: async () => {
      let staged = '';
      return {
        write: async (data: unknown) => {
          staged = String(data);
        },
        close: async () => {
          disk = staged;
        },
        abort: async () => undefined,
      };
    },
  };
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: vi.fn(async () => handle),
  });
  useStore.setState({
    project: { ...createProject(), notes: 'older' },
    dirty: true,
    lastSaveTarget: retained,
    savedName: 'shared.lf2',
  });
  const older = handleSaveProject(context(webAdapter));
  await started.promise;
  useStore.getState().setProjectNotes('newest');
  await expect(handleSaveProject(context(webAdapter), true)).resolves.toBe('saved');
  expect(savedNote(disk)).toBe('newest');
  gate.resolve();
  await expect(older).resolves.toBe('stale-request');
  await vi.waitFor(() => {
    expect(savedNote(disk)).toBe('newest');
    expect(useStore.getState().dirty).toBe(false);
  });
});

it('restores newer bytes through a real filesystem alias after an older path Save finishes late', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'kerfdesk-save-alias-'));
  const physicalRoot = await realpath(temp);
  const realDir = join(temp, 'real');
  const aliasDir = join(temp, 'alias');
  try {
    await mkdir(realDir);
    await symlink(realDir, aliasDir, 'junction');
    const realFile = join(realDir, 'shared.lf2');
    const aliasFile = join(aliasDir, 'shared.lf2');
    await writeFile(realFile, '{}');
    const original = await checkDesktopProjectPath(realFile);
    const alias = await checkDesktopProjectPath(aliasFile);
    if (original.kind !== 'file' || alias.kind !== 'file')
      throw new Error('Expected checked alias paths');
    expect(alias.realPath).toBe(original.realPath);
    const gate = deferred();
    const started = deferred();
    const files = createDesktopProjectFiles(undefined, {
      events: new EventTarget(),
      fetchRoute: async (url, init) => {
        const candidate = new URL(url, 'https://test.invalid').searchParams.get('path');
        if (!candidate) throw new Error('Missing chosen path');
        if (candidate === realFile) {
          started.resolve();
          await gate.promise;
        }
        const checked = await checkDesktopProjectPath(candidate);
        if (checked.kind !== 'file') throw new Error('Lost alias path');
        const bytes = new TextEncoder().encode(String(init.body));
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
        const result = await saveDesktopProjectFile(checked.realPath, body);
        return new Response(null, { status: result === 'saved' ? 204 : 500 });
      },
    });
    const retained = files.openedProjectSaveTarget({
      kind: 'desktop-path',
      path: realFile,
      token: 'a'.repeat(43),
    });
    const picked = files.openedProjectSaveTarget({
      kind: 'desktop-path',
      path: aliasFile,
      token: 'b'.repeat(43),
    });
    if (!retained || !picked) throw new Error('Expected checked Save targets');
    const platform: PlatformAdapter = { ...webAdapter, pickFileForSave: async () => picked };
    useStore.setState({
      project: { ...createProject(), notes: 'older alias' },
      dirty: true,
      lastSaveTarget: retained,
      savedName: 'shared.lf2',
    });
    const older = handleSaveProject(context(platform));
    await started.promise;
    useStore.getState().setProjectNotes('newest alias');
    await expect(handleSaveProject(context(platform), true)).resolves.toBe('saved');
    gate.resolve();
    await expect(older).resolves.toBe('stale-request');
    await vi.waitFor(async () => {
      expect(savedNote(await readFile(realFile, 'utf8'))).toBe('newest alias');
      expect(useStore.getState().dirty).toBe(false);
    });
  } finally {
    await removeAliasFixture(physicalRoot, aliasDir);
  }
});

async function removeAliasFixture(physicalRoot: string, aliasDir: string): Promise<void> {
  const ownerRoot = await realpath(tmpdir());
  const child = relative(ownerRoot, physicalRoot);
  if (
    !child ||
    isAbsolute(child) ||
    child.startsWith(`..${sep}`) ||
    child === '..' ||
    !basename(physicalRoot).startsWith('kerfdesk-save-alias-')
  )
    throw new Error('Fixture cleanup escaped its owned temporary root');
  // Remove the junction itself first; recursive cleanup stays in the exact
  // temporary fixture we created, never traverses its alias target.
  await unlink(aliasDir).catch((error: unknown) => {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  });
  await rm(physicalRoot, { recursive: true, force: true });
}
