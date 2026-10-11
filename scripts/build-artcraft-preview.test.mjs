import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { artcraftPreviewEntry } from './build-artcraft-preview.mjs';
test('source preview omits only the commercial client from the verified development entry', async () => {
  const source = await readFile(new URL('../src/ui/app/main.tsx', import.meta.url), 'utf8');
  const transformed = artcraftPreviewEntry(source);
  assert.match(transformed, /const desktopLicenceClient = undefined;/u);
  assert.ok(transformed.includes('<ErrorBoundary softwareAbort={softwareAbort}>'));
  assert.ok(transformed.includes('desktopWindow: createDesktopWindowCommands()'));
  assert.ok(transformed.includes('? { unlicensedRunsFree: false }'));
  assert.equal(await readFile(new URL('../src/ui/app/main.tsx', import.meta.url), 'utf8'), source);
});
test('source preview refuses a changed entry instead of silently bypassing a new policy', () => {
  assert.throws(
    () => artcraftPreviewEntry('const desktopLicenceClient = somethingNew();'),
    /entry changed/u,
  );
});
