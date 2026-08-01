import { TABLER_ASSETS, type TablerAssetName } from './design-library-tabler-assets';
import { TABLER_MANIFEST, type TablerManifestEntry } from './design-library-tabler-manifest';
import type { LibraryEntry } from './design-library-types';

const TABLER_VERSION = '3.43.0';
const TABLER_COMMIT = 'e40738b64486f857128ae58335354681e4e9dc9b';
const TABLER_SOURCE_ROOT = `https://github.com/tabler/tabler-icons/blob/${TABLER_COMMIT}`;

function tablerEntry(item: TablerManifestEntry): LibraryEntry {
  const asset = TABLER_ASSETS[item.asset];
  return {
    id: `tabler-${item.asset}`,
    title: item.title,
    category: 'Icons & Symbols',
    subcategory: item.collection,
    kind: 'bundled-artwork',
    machineModes: ['laser', 'cnc'],
    operations: ['line'],
    tags: ['outline', 'engraving', 'tabler', ...item.tags],
    provenance: {
      sourceKind: 'tabler',
      sourceName: 'Tabler Icons',
      creator: 'Paweł Kuna and Tabler Icons contributors',
      license: 'MIT',
      licenseId: 'MIT',
      sourceUrl: `${TABLER_SOURCE_ROOT}/icons/outline/${item.asset}.svg`,
      licenseUrl: `${TABLER_SOURCE_ROOT}/LICENSE`,
      sourceVersion: `@tabler/icons@${TABLER_VERSION} / v${TABLER_VERSION} / ${TABLER_COMMIT}`,
      downloadedAt: '2026-07-31',
      assetHash: `sha256:${item.sha256}`,
      notice: 'Unmodified outline asset from the pinned Tabler Icons 3.43.0 MIT release.',
    },
    preview: { kind: 'asset-url', url: asset.previewUrl },
    insert: { kind: 'svg', loadSvgText: asset.loadSvgText },
  };
}

export const TABLER_LIBRARY_ENTRIES: ReadonlyArray<LibraryEntry> = TABLER_MANIFEST.map(tablerEntry);

export const TABLER_LIBRARY_ASSET_NAMES: ReadonlyArray<TablerAssetName> = TABLER_MANIFEST.map(
  (entry) => entry.asset,
);
