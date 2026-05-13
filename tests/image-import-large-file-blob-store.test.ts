/**
 * T1-17 follow-up: large local image imports must not route through the
 * base64 data-URI storage/render path. Pre-fix, importing a phone photo
 * read the whole file as a data URI, hashed that huge string, stored it
 * in IndexedDB, and then resolved it back to a data URI for canvas draw.
 *
 * Run: npx tsx tests/image-import-large-file-blob-store.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chooseImageImportStorageStrategy,
  IMAGE_INDEXEDDB_THRESHOLD,
} from '../src/import/image/ImageImportStorageStrategy';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-17 large image import uses blob-backed storage ===\n');

{
  assert(
    chooseImageImportStorageStrategy({ kind: 'file', sizeBytes: IMAGE_INDEXEDDB_THRESHOLD + 1 }) === 'indexeddb-blob',
    'large File imports use Blob-backed IndexedDB storage',
  );
  assert(
    chooseImageImportStorageStrategy({ kind: 'file', sizeBytes: IMAGE_INDEXEDDB_THRESHOLD }) === 'inline-data-uri',
    'small File imports stay inline',
  );
  assert(
    chooseImageImportStorageStrategy({ kind: 'data-uri', dataUriLength: IMAGE_INDEXEDDB_THRESHOLD + 1 }) === 'indexeddb-data-uri',
    'large data-URI imports keep the data-URI IndexedDB fallback',
  );
  assert(
    chooseImageImportStorageStrategy({ kind: 'data-uri', dataUriLength: IMAGE_INDEXEDDB_THRESHOLD }) === 'inline-data-uri',
    'small data-URI imports stay inline',
  );
}

{
  const imageStoreSource = readFileSync(resolve('src/io/ImageStore.ts'), 'utf-8');
  assert(/export async function storeImageBlob/.test(imageStoreSource),
    'ImageStore exposes storeImageBlob for large local files');
  assert(/export async function getImageRenderSrc/.test(imageStoreSource),
    'ImageStore exposes getImageRenderSrc for renderer object URLs');
  assert(/blob\?: Blob/.test(imageStoreSource),
    'StoredImage can persist Blob payloads');
  assert(/FileReader/.test(imageStoreSource),
    'ImageStore can convert Blob payloads back to data URIs for portable save/export');
}

{
  const importSource = readFileSync(resolve('src/ui/hooks/useImport.ts'), 'utf-8');
  assert(/storeImageBlob/.test(importSource),
    'useImport routes large File imports through storeImageBlob');
  assert(/URL\.createObjectURL\(source\)/.test(importSource),
    'useImport decodes File imports through object URLs instead of mandatory data URI reads');
  assert(/typeof URL\.createObjectURL === 'function'/.test(importSource),
    'useImport falls back cleanly when object URLs are unavailable');
  assert(/readFileAsDataUri\(source\)/.test(importSource),
    'useImport reads File data URIs only for inline-small-file storage');
}

{
  const rendererSource = readFileSync(resolve('src/ui/renderers/SceneRenderer.ts'), 'utf-8');
  assert(/getImageRenderSrc/.test(rendererSource),
    'SceneRenderer resolves indexeddb refs through render srcs instead of export data URIs');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
