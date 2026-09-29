import { describe, expect, it, vi } from 'vitest';
import type { RecentFileRef, SaveTarget } from '../types';
import { createDesktopProjectFiles } from './desktop-project-files';

const TOKEN = 'a'.repeat(43);
const PATH_REF: RecentFileRef = { kind: 'desktop-path', path: 'D:\\Jobs\\Sign.lf2', token: TOKEN };

function savingFiles(status = 204, handleSaveTarget?: (ref: RecentFileRef) => SaveTarget | null) {
  const fetchRoute = vi.fn(async (_input: string, _init: RequestInit) =>
    status === 204 ? new Response(null, { status }) : Response.json({}, { status }),
  );
  const files = createDesktopProjectFiles(undefined, {
    fetchRoute,
    events: new EventTarget(),
    handleSaveTarget,
  });
  return { files, fetchRoute };
}

function pathTarget(files: ReturnType<typeof savingFiles>['files']): SaveTarget {
  const target = files.openedProjectSaveTarget(PATH_REF);
  if (target === null) throw new Error('expected a save target');
  return target;
}

describe('saving over a project the operating system opened (ADR-550)', () => {
  it('sends the project to main for exactly that path and token', async () => {
    const { files, fetchRoute } = savingFiles();
    const target = pathTarget(files);

    expect(target.displayName).toBe('Sign.lf2');
    expect(target.recentRef).toEqual(PATH_REF);
    await target.write('{"v":7}');

    const [url, init] = fetchRoute.mock.calls[0] ?? [];
    expect(url).toBe(`./api/desktop-project-file?path=D%3A%5CJobs%5CSign.lf2&token=${TOKEN}`);
    expect(init).toMatchObject({
      method: 'PUT',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-KerfDesk-Project': '1' },
      body: '{"v":7}',
    });
  });

  it.each([
    [404, 'the file is no longer there. Use Save As to choose where to save.'],
    [403, 'KerfDesk may no longer change it. Use Save As to save a copy.'],
    [413, 'the project is too large to save.'],
    [500, 'KerfDesk could not write the file. It may be read-only or open in another program.'],
    [200, 'KerfDesk could not write the file. It may be read-only or open in another program.'],
  ])('reports a %i answer as a failed save', async (status, message) => {
    const { files } = savingFiles(status);
    await expect(pathTarget(files).write('{}')).rejects.toThrow(message);
  });

  it('never writes LightBurn files, which open as imports', () => {
    const { files } = savingFiles();
    expect(
      files.openedProjectSaveTarget({ kind: 'desktop-path', path: 'D:\\Sign.lbrn2', token: TOKEN }),
    ).toBeNull();
  });

  it('knows the same path in any letter case as one destination', async () => {
    const { files } = savingFiles();
    const upper = files.openedProjectSaveTarget({
      kind: 'desktop-path',
      path: 'd:/jobs/SIGN.lf2',
      token: TOKEN,
    });
    if (upper === null) throw new Error('expected a save target');
    await expect(pathTarget(files).isSameDestination?.(upper)).resolves.toBe(true);
    const other = { displayName: 'Sign.lf2', write: async () => undefined };
    await expect(pathTarget(files).isSameDestination?.(other)).resolves.toBe(false);
  });

  it('leaves files picked in the app to the handle targets', () => {
    const picked: RecentFileRef = {
      kind: 'handle',
      handle: { kind: 'file', name: 'a.lf2' } as unknown as FileSystemFileHandle,
    };
    const handleTarget = { displayName: 'a.lf2', write: async () => undefined };
    const handleSaveTarget = vi.fn(() => handleTarget);
    expect(savingFiles(204, handleSaveTarget).files.openedProjectSaveTarget(picked)).toBe(
      handleTarget,
    );
    expect(handleSaveTarget).toHaveBeenCalledWith(picked);
    expect(savingFiles().files.openedProjectSaveTarget(picked)).toBeNull();
  });
});
