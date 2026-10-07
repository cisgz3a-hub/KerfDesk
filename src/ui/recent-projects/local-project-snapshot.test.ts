import { describe, expect, it } from 'vitest';
import { deserializeProject } from '../../io/project';
import {
  artworkProject,
  assetReader,
  pagedProject,
} from '../library/personal-artwork-test-fixtures';
import { captureLocalProjectSnapshot, validateSnapshotCapacity } from './local-project-snapshot';

describe('complete local project snapshots', () => {
  it('embeds original pixels and engraving luma instead of storing dependent asset IDs', async () => {
    const copy = await captureLocalProjectSnapshot(
      pagedProject(),
      'Before engraving',
      assetReader(),
    );
    const decoded = deserializeProject(copy.projectJson);
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok') throw new Error('snapshot did not round trip');
    expect(
      decoded.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).toMatchObject({
      dataUrl: 'data:image/png;base64,AQIDBA==',
      lumaBase64: 'AECA/w==',
    });
    expect(
      decoded.project.scene.objects.find((object) => object.kind === 'raster-image'),
    ).not.toHaveProperty('imageAsset');
    expect(copy.bytes).toBe(new TextEncoder().encode(copy.projectJson).byteLength);
    expect(copy.notesExcerpt).toBe('Template setup notes');
  });

  it('preserves unused operations, font data, notes and job setup without changing the source', async () => {
    const project = artworkProject();
    const before = JSON.stringify(project);
    const copy = await captureLocalProjectSnapshot(project, '  Try a new layout  ');
    const decoded = deserializeProject(copy.projectJson);
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok') throw new Error('snapshot did not round trip');
    expect(decoded.project).toMatchObject({
      notes: project.notes,
      jobSetup: project.jobSetup,
      embeddedFonts: project.embeddedFonts,
      optimization: project.optimization,
    });
    expect(decoded.project.scene.layers.map((layer) => layer.id)).toEqual(
      project.scene.layers.map((layer) => layer.id),
    );
    expect(copy.name).toBe('Try a new layout');
    expect(JSON.stringify(project)).toBe(before);
  });

  it('rejects a blank label and capacity exhaustion without evicting existing copies', async () => {
    await expect(captureLocalProjectSnapshot(artworkProject(), ' ')).rejects.toThrow('name');
    const copy = await captureLocalProjectSnapshot(artworkProject(), 'Copy');
    const headers = Array.from({ length: 12 }, (_, index) => ({ ...copy, id: `copy-${index}` }));
    expect(() => validateSnapshotCapacity(headers, copy)).toThrow('slots are full');
    expect(headers).toHaveLength(12);
    expect(() =>
      validateSnapshotCapacity([{ ...copy, id: 'existing', bytes: 256 * 1024 * 1024 }], copy),
    ).toThrow('storage budget');
  });
});
