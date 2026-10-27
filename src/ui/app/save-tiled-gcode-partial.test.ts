// Rolling audit v5 J2-P2-2 (ADR-656 Amendment 3): a tiled save that stops at a
// failed write, into a folder holding an earlier save of the same job, left
// every later tile with the earlier save's contents under this save's names.
// The toasts said "Saved 1 of N" and named the failed write, but not the
// stale files, and the earlier-files check left out every name this save
// planned. Run through the real web adapter on Chromium's file model, where a
// failed write keeps the file's old contents (ADR-656 decision 5).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareOutput } from '../../io/gcode';
import type { Project } from '../../core/scene';
import {
  chromiumDirectory,
  type FakeDisk,
} from '../../platform/web/chromium-save-picker.test-support';
import { webAdapter } from '../../platform/web/web-adapter';
import type { TiledOutputPreparationRequest } from '../laser/output-preparation-protocol';
import { handleSaveTiledGcode } from './save-tiled-gcode';
import { tiledCncProject } from './save-tiled-gcode-testing';
import { finalizeTiledOutput } from './tiled-output-preparation';

vi.mock('../laser/output-preparation-worker-client', () => ({
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE: 'Background compilation unavailable.',
  prepareTiledOutputOffThread: (request: TiledOutputPreparationRequest) =>
    Promise.resolve(
      finalizeTiledOutput(
        prepareOutput(request.project, request.options),
        request.savedName,
        request.controllerSettings ?? null,
        request.activeWcs ?? null,
      ),
    ),
}));

const EARLIER = 'G0 X0 (the earlier design)';
const DISK_FULL = Object.assign(new Error('There is not enough space on the disk.'), {
  name: 'QuotaExceededError',
});

type Toast = { readonly message: string; readonly variant: string };

function manyTileProject(): Project {
  const base = tiledCncProject();
  if (base.machine?.kind !== 'cnc') throw new Error('expected a CNC project');
  return {
    ...base,
    machine: {
      ...base.machine,
      tiling: { tileWidthMm: 25, tileHeightMm: 25, overlapMm: 0, registrationHoles: false },
    },
  };
}

/** The folder the operator picks; writes to `failing` fail as a full disk does. */
function pickFolder(disk: FakeDisk, failing: string | null): void {
  const folder = chromiumDirectory(disk);
  const full = chromiumDirectory(disk, { writeError: DISK_FULL });
  const directory = {
    ...folder,
    getFileHandle: (name: string, options?: { readonly create?: boolean }) =>
      (name === failing ? full : folder).getFileHandle(name, options),
  } as FileSystemDirectoryHandle;
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: async () => directory,
  });
}

async function saveTiles(project: Project): Promise<ReadonlyArray<Toast>> {
  const toasts: Toast[] = [];
  await handleSaveTiledGcode({
    platform: webAdapter,
    project,
    savedName: 'job',
    pushToast: (message, variant) => toasts.push({ message, variant: String(variant) }),
  });
  return toasts;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'showDirectoryPicker');
});

describe('a tiled save cut short by a write error', () => {
  it('names the tiles that still hold the earlier save', async () => {
    const project = manyTileProject();
    const disk: FakeDisk = new Map();
    pickFolder(disk, null);
    await saveTiles(project);
    // In write order.
    const names = [...disk.keys()];
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) disk.set(name, EARLIER);

    const failing = names[1] ?? '';
    pickFolder(disk, failing);
    const toasts = await saveTiles(project);

    // The file the save reached is this design; every later one, the failed
    // one included, still holds the earlier save under this save's name.
    expect(disk.get(names[0] ?? '')).not.toBe(EARLIER);
    const stale = names.slice(1);
    for (const name of stale) expect(disk.get(name)).toBe(EARLIER);
    const failed = toasts.find((toast) => toast.message.startsWith('Could not write'));
    expect(failed?.message).toContain(failing.replace(/\.nc$/, ''));
    expect(failed?.variant).toBe('error');
    expect(toasts).toContainEqual({
      message: `Saved 1 of ${names.length} tile files, so the set is incomplete. Save it again before cutting.`,
      variant: 'warning',
    });
    const warning = toasts.find((toast) => toast.message.startsWith('These files still hold'));
    expect(warning?.variant).toBe('error');
    for (const name of stale) expect(warning?.message).toContain(name);
    expect(warning?.message).toContain('Delete them, or save the tiles again, before cutting.');
    // Only the file this save wrote is called replaced.
    const replaced = toasts.find((toast) => toast.message.startsWith('This save replaced'));
    expect(replaced?.message).toBe(
      `This save replaced 1 file(s) already in the folder: ${names[0]}.`,
    );
  });

  it('calls nothing stale when the folder held none of the names', async () => {
    const disk: FakeDisk = new Map();
    pickFolder(disk, null);
    await saveTiles(manyTileProject());
    const names = [...disk.keys()];
    disk.clear();

    pickFolder(disk, names[1] ?? '');
    const toasts = await saveTiles(manyTileProject());

    // The failed write's new entry is removed (ADR-656 decision 5).
    expect([...disk.keys()]).toEqual([names[0]]);
    expect(toasts.some((toast) => toast.message.startsWith('These files still hold'))).toBe(false);
  });

  it('keeps the success message for a complete set', async () => {
    const disk: FakeDisk = new Map();
    pickFolder(disk, null);
    const toasts = await saveTiles(manyTileProject());
    expect(toasts.find((toast) => toast.variant === 'success')?.message).toMatch(
      /^Saved all \d+ tile files\./,
    );
    expect(toasts.some((toast) => toast.message.startsWith('These files still hold'))).toBe(false);
  });
});
