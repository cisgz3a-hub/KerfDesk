import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportedSvg } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

describe('Library insertion identity', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds repeated Library assets as independently editable objects', () => {
    const provenance = {
      schemaVersion: 1,
      assetId: 'icon-flower',
      title: 'Flower',
      sourceName: 'Lucide',
      licenseId: 'ISC',
    } as const;
    const first: ImportedSvg = {
      ...svgObj('library-flower-1', ['#000000']),
      source: 'Library: Flower',
      libraryProvenance: provenance,
    };
    const second: ImportedSvg = {
      ...svgObj('library-flower-2', ['#000000']),
      source: 'Library: Flower',
      libraryProvenance: provenance,
    };

    expect(useStore.getState().importSvgObject(first).kind).toBe('added');
    expect(useStore.getState().importSvgObject(second).kind).toBe('added');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'library-flower-1',
      'library-flower-2',
    ]);
  });
});
