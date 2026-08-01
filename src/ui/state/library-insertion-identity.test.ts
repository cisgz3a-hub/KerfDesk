import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportedSvg } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const LIBRARY_PROVENANCE = {
  schemaVersion: 1,
  assetId: 'icon-flower',
  title: 'Flower',
  sourceName: 'Lucide',
  licenseId: 'ISC',
} as const;

describe('Library insertion identity', () => {
  beforeEach(() => {
    resetStore();
  });

  it('adds repeated Library assets as independently editable objects', () => {
    const first: ImportedSvg = {
      ...svgObj('library-flower-1', ['#000000']),
      source: 'Library: Flower',
      libraryProvenance: LIBRARY_PROVENANCE,
    };
    const second: ImportedSvg = {
      ...svgObj('library-flower-2', ['#000000']),
      source: 'Library: Flower',
      libraryProvenance: LIBRARY_PROVENANCE,
    };

    expect(useStore.getState().importSvgObject(first).kind).toBe('added');
    expect(useStore.getState().importSvgObject(second).kind).toBe('added');
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'library-flower-1',
      'library-flower-2',
    ]);
  });

  it('adds a Library asset when an ordinary import has the same display source', () => {
    const ordinary = importedSvg('ordinary-first', 'shared.svg');
    const library = importedSvg('library-second', 'shared.svg', LIBRARY_PROVENANCE);

    expect(useStore.getState().importSvgObject(ordinary).kind).toBe('added');
    expect(useStore.getState().importSvgObject(library).kind).toBe('added');
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'ordinary-first',
      'library-second',
    ]);
  });

  it('adds an ordinary import when a Library asset has the same display source', () => {
    const library = importedSvg('library-first', 'shared.svg', LIBRARY_PROVENANCE);
    const ordinary = importedSvg('ordinary-second', 'shared.svg');

    expect(useStore.getState().importSvgObject(library).kind).toBe('added');
    expect(useStore.getState().importSvgObject(ordinary).kind).toBe('added');
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'library-first',
      'ordinary-second',
    ]);
  });

  it('reimports only the ordinary object when both identities share a display source', () => {
    const ordinary = importedSvg('ordinary-first', 'shared.svg');
    const library = importedSvg('library-first', 'shared.svg', LIBRARY_PROVENANCE);
    const ordinaryRevision = importedSvg('ordinary-revision', 'shared.svg', undefined, '#ff0000');

    expect(useStore.getState().importSvgObject(ordinary).kind).toBe('added');
    expect(useStore.getState().importSvgObject(library).kind).toBe('added');
    expect(useStore.getState().importSvgObject(ordinaryRevision).kind).toBe('replaced');
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'ordinary-first',
      'library-first',
    ]);
    const preservedLibrary = useStore
      .getState()
      .project.scene.objects.find((object) => object.id === 'library-first');
    const replacedOrdinary = useStore
      .getState()
      .project.scene.objects.find((object) => object.id === 'ordinary-first');
    expect(replacedOrdinary).toMatchObject({ paths: [{ color: '#ff0000' }] });
    expect(preservedLibrary).toMatchObject({ libraryProvenance: LIBRARY_PROVENANCE });
    expect(preservedLibrary).toMatchObject({ paths: [{ color: '#000000' }] });
  });
});

function importedSvg(
  id: string,
  source: string,
  libraryProvenance?: ImportedSvg['libraryProvenance'],
  color = '#000000',
): ImportedSvg {
  return {
    ...svgObj(id, [color]),
    source,
    ...(libraryProvenance === undefined ? {} : { libraryProvenance }),
  };
}
