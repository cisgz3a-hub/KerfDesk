import { describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from './design-library-types';
import { insertLibraryEntryForDocument, librarySvgObjectFor } from './library-entry-insert';
import { ownedClipImage } from '../../__fixtures__/owned-image-clip';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function entry(loadSvgText: () => Promise<string>): LibraryEntry {
  return {
    id: 'deferred-library-entry',
    title: 'Deferred design',
    category: 'Decorative Artwork',
    subcategory: 'Test',
    kind: 'bundled-artwork',
    machineModes: ['laser', 'cnc'],
    operations: ['line'],
    tags: ['test'],
    provenance: {
      sourceKind: 'owned',
      sourceName: 'KerfDesk',
      license: 'MIT',
      licenseId: 'MIT',
    },
    preview: { kind: 'inline-svg', svgText: '<svg />' },
    insert: { kind: 'svg', loadSvgText },
  };
}

describe('library insertion document ownership', () => {
  it('explicitly refuses composed image content in a singular vector destination', async () => {
    const svg =
      '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><image width="10" height="10" preserveAspectRatio="none" href="' +
      ownedClipImage().dataUrl +
      '"/></svg>';
    await expect(
      librarySvgObjectFor(
        entry(async () => svg),
        'mixed',
      ),
    ).rejects.toThrow(/contains bitmap content/);
  });
  it('silently discards a deferred asset load after a replacement document opens', async () => {
    const loaded = deferred<string>();
    let epoch = 4;
    const importSvgObject = vi.fn(() => ({ kind: 'added' as const }));
    const pending = insertLibraryEntryForDocument({
      entry: entry(() => loaded.promise),
      id: 'library-object',
      getProjectDocumentEpoch: () => epoch,
      isRequestCurrent: () => true,
      importSvgObject,
    });

    epoch += 1;
    loaded.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10" stroke="#000"/></svg>',
    );

    await expect(pending).resolves.toBe('stale');
    expect(importSvgObject).not.toHaveBeenCalled();
  });

  it('silently discards a deferred asset load after its dialog request closes', async () => {
    const loaded = deferred<string>();
    let requestCurrent = true;
    const importSvgObject = vi.fn(() => ({ kind: 'added' as const }));
    const pending = insertLibraryEntryForDocument({
      entry: entry(() => loaded.promise),
      id: 'library-object',
      getProjectDocumentEpoch: () => 4,
      isRequestCurrent: () => requestCurrent,
      importSvgObject,
    });

    requestCurrent = false;
    loaded.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10" stroke="#000"/></svg>',
    );

    await expect(pending).resolves.toBe('stale');
    expect(importSvgObject).not.toHaveBeenCalled();
  });
});
