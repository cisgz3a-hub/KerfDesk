import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import {
  artworkProject,
  assetReader,
  pagedProject,
} from '../library/personal-artwork-test-fixtures';
import { captureLocalProjectSnapshot } from '../recent-projects/local-project-snapshot';
import { portableProjectAssets } from './portable-project-assets';

function book() {
  return {
    ...createProject(),
    sheetBook: {
      activeId: 'blank',
      activeName: 'Blank sheet',
      inactive: [{ id: 'art', name: 'Logo sheet', projectJson: serializeProject(pagedProject()) }],
    },
  };
}

describe('portable inactive project sheet assets', () => {
  it('embeds archived original/luma bytes and preserves editable fonts without changing the source archive', async () => {
    const original = book();
    const before = original.sheetBook.inactive[0]!.projectJson;
    const portable = await portableProjectAssets(original, assetReader());
    const archive = deserializeProject(portable.sheetBook!.inactive[0]!.projectJson);
    expect(archive.kind).toBe('ok');
    if (archive.kind !== 'ok') throw new Error('archived sheet did not reopen');
    expect(
      archive.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).toMatchObject({
      dataUrl: 'data:image/png;base64,AQIDBA==',
      lumaBase64: 'AECA/w==',
    });
    expect(
      archive.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).not.toHaveProperty('imageAsset');
    expect(archive.project.embeddedFonts).toEqual(pagedProject().embeddedFonts);
    expect(original.sheetBook.inactive[0]!.projectJson).toBe(before);
  });

  it('captures a self-contained named local snapshot of the whole sheet book', async () => {
    const copy = await captureLocalProjectSnapshot(book(), 'Whole job', assetReader());
    const opened = deserializeProject(copy.projectJson);
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('book did not reopen');
    expect(opened.project.sheetBook?.inactive).toHaveLength(1);
    const archived = deserializeProject(opened.project.sheetBook!.inactive[0]!.projectJson);
    expect(archived.kind).toBe('ok');
    if (archived.kind !== 'ok') throw new Error('copy archive did not reopen');
    expect(
      archived.project.scene.objects.some(
        (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
      ),
    ).toBe(false);
  });

  it('rejects unavailable archived pixels and cancellation instead of silently dropping the inactive sheet', async () => {
    const unavailable = { ...assetReader(), readManifest: async () => null };
    await expect(portableProjectAssets(book(), unavailable)).rejects.toThrow(
      'Original image pixels',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(portableProjectAssets(book(), assetReader(), controller.signal)).rejects.toThrow(
      'cancelled',
    );
  });

  it('requires missing editable font data from inactive sheets as well as the active scene', async () => {
    const source = book();
    const missingFont = { ...artworkProject(), embeddedFonts: [] };
    const incomplete = {
      ...source,
      sheetBook: {
        ...source.sheetBook,
        inactive: [
          { id: 'art', name: 'Missing font sheet', projectJson: serializeProject(missingFont) },
        ],
      },
    };
    await expect(portableProjectAssets(incomplete, assetReader())).rejects.toThrow(
      'Embed the missing font',
    );
  });
});
