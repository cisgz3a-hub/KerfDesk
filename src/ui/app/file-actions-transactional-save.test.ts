import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { handleSaveGcode, prebuildGcodeSave, type SaveGcodeCtx } from './file-actions';

describe.each(['web', 'electron'] as const)('%s transactional Save G-code', (platformId) => {
  it('does not select, create, or modify a final target when preparation fails', async () => {
    const target = targetMock();
    const pickFileForSave = vi.fn(async () => target.target);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    await handleSaveGcode(context(platformId, createProject(), pickFileForSave));

    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(target.write).not.toHaveBeenCalled();
  });

  it('writes only an exact prebuilt artifact from the destination-selection gesture', async () => {
    const target = targetMock();
    const pickFileForSave = vi.fn(async () => target.target);
    const ctx = context(platformId, projectWithLine(), pickFileForSave);
    const artifact = await prebuildGcodeSave(ctx);
    if (artifact === null) throw new Error('expected prebuilt G-code');

    expect(pickFileForSave).not.toHaveBeenCalled();
    await handleSaveGcode(ctx, { prebuilt: artifact });

    expect(pickFileForSave).toHaveBeenCalledOnce();
    expect(target.write).toHaveBeenCalledOnce();
    expect(target.written[0]).toContain('G21');
  });
});

function context(
  id: 'web' | 'electron',
  project: ReturnType<typeof createProject>,
  pickFileForSave: PlatformAdapter['pickFileForSave'],
): SaveGcodeCtx {
  return {
    platform: {
      id,
      pickFilesForOpen: async () => [],
      pickFileForSave,
      serial: { isSupported: () => false, requestPort: async () => null },
    },
    project,
    savedName: null,
    pushToast: vi.fn(),
  };
}

function targetMock(): {
  readonly target: SaveTarget;
  readonly write: ReturnType<typeof vi.fn>;
  readonly written: string[];
} {
  const written: string[] = [];
  const write = vi.fn(async (data: string | Blob) => {
    if (typeof data === 'string') written.push(data);
  });
  return { target: { displayName: 'job.gcode', write }, write, written };
}
