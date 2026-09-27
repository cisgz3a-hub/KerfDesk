import { describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import type * as sceneSvg from '../../io/svg/export-scene-svg';
import { exportSceneSvg } from '../../io/svg/export-scene-svg';
import { handleExportArtworkSvg } from './export-artwork-svg';

vi.mock('../../io/svg/export-scene-svg', async (importOriginal) => {
  const actual = await importOriginal<typeof sceneSvg>();
  return { ...actual, exportSceneSvg: vi.fn(actual.exportSceneSvg) };
});

async function exportWith(groupContours: boolean | undefined): Promise<unknown> {
  vi.mocked(exportSceneSvg).mockClear();
  const platform = {
    ...mockPlatform(),
    pickFileForSave: vi.fn(async () => ({ displayName: 'a.svg', write: async () => undefined })),
  };
  await handleExportArtworkSvg({
    platform,
    project: projectWithLine(),
    selectedIds: [],
    savedName: null,
    pushToast: () => undefined,
    ...(groupContours === undefined ? {} : { groupContours }),
  });
  expect(exportSceneSvg).toHaveBeenCalledTimes(1);
  return vi.mocked(exportSceneSvg).mock.calls[0]?.[2];
}

describe('Export artwork as SVG: Group islands (ADR-451)', () => {
  it('passes no export options by default, so the file is unchanged', async () => {
    expect(await exportWith(undefined)).toEqual({});
    expect(await exportWith(false)).toEqual({});
  });

  it('asks the SVG writer to group contours when Group islands is on', async () => {
    expect(await exportWith(true)).toEqual({ groupContours: true });
  });
});
