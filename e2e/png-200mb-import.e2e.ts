import { expect, test } from '@playwright/test';
import { mkdtempSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeQualifiedLargeIdatPngFixture } from './fixtures/png-fixture';

const TARGET_BYTES = 200 * 1024 * 1024;
const THUMBNAIL_MAX_EDGE = 256;
const THUMBNAIL_MAX_DATA_URL_LENGTH =
  'data:image/bmp;base64,'.length +
  4 * Math.ceil((54 + Math.ceil((THUMBNAIL_MAX_EDGE * 3) / 4) * 4 * THUMBNAIL_MAX_EDGE) / 3);
let fixtureDirectory = '';
let fixturePath = '';
let fixtureIdatBytes = 0;

test.beforeAll(async ({ browserName }, testInfo) => {
  testInfo.setTimeout(120_000);
  expect(browserName).toBe('chromium');
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'curvedesk-png-200mib-'));
  fixturePath = join(fixtureDirectory, 'qualified-200-mib.png');
  const fixture = await writeQualifiedLargeIdatPngFixture(fixturePath, TARGET_BYTES);
  fixtureIdatBytes = fixture.idatBytes;
  expect(statSync(fixturePath).size).toBe(TARGET_BYTES);
  expect(fixture.idatBytes).toBeGreaterThan(TARGET_BYTES * 0.9);
  expect(fixture.ancillaryBytes).toBeGreaterThan(0);
});

test.afterAll(() => {
  if (fixturePath !== '') unlinkSync(fixturePath);
  if (fixtureDirectory !== '') rmdirSync(fixtureDirectory);
});

test('production Import Image accepts a qualified 200 MiB PNG without UI whole-file retention', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(300_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: () =>
        new Promise((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.addEventListener(
            'change',
            () => {
              const file = input.files?.[0];
              if (file === undefined) {
                reject(new DOMException('No file selected', 'AbortError'));
                return;
              }
              resolve([
                {
                  kind: 'file',
                  name: file.name,
                  getFile: async () => file,
                },
              ]);
            },
            { once: true },
          );
          input.click();
        }),
    });
  });
  await page.goto('/');
  await page.evaluate(() => {
    const scope = window as Window & {
      __png200Heartbeat?: number;
      __png200HeartbeatTimer?: number;
    };
    scope.__png200Heartbeat = 0;
    scope.__png200HeartbeatTimer = window.setInterval(() => {
      scope.__png200Heartbeat = (scope.__png200Heartbeat ?? 0) + 1;
    }, 10);
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const baselineHeap = await mainFrameHeapBytes(cdp);
  let maxMainFrameHeap = baselineHeap;
  let sampling = false;
  const sampleHeap = async (): Promise<void> => {
    if (sampling) return;
    sampling = true;
    try {
      maxMainFrameHeap = Math.max(maxMainFrameHeap, await mainFrameHeapBytes(cdp));
    } finally {
      sampling = false;
    }
  };
  const sampler = setInterval(() => void sampleHeap(), 100);
  try {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Image...' }).click();
    await (await chooser).setFiles(fixturePath);
    await expect
      .poll(() => importedAssetState(page), { timeout: 280_000, intervals: [250, 500, 1_000] })
      .toMatchObject({
        objectCount: 1,
        source: {
          state: 'ready',
          byteLength: TARGET_BYTES,
          pageCount: 200,
        },
        naturalWidth: 8192,
        naturalHeight: 8192,
        sampledWidth: 5657,
        sampledHeight: 5657,
        luma: {
          state: 'ready',
          byteLength: 5657 * 5657,
          pageCount: 31,
        },
        hasDataUrl: false,
        hasLumaBase64: false,
      });
    await sampleHeap();
  } finally {
    clearInterval(sampler);
  }

  const result = await importedAssetState(page);
  const lumaEdges = await sampledLumaEdges(page);
  const heartbeatTicks = await page.evaluate(() => {
    const scope = window as Window & {
      __png200Heartbeat?: number;
      __png200HeartbeatTimer?: number;
    };
    if (scope.__png200HeartbeatTimer !== undefined) {
      window.clearInterval(scope.__png200HeartbeatTimer);
    }
    return scope.__png200Heartbeat ?? 0;
  });
  const heapGrowth = maxMainFrameHeap - baselineHeap;
  console.log(
    `200 MiB PNG measurement: IDAT=${fixtureIdatBytes}, main-frame JS heap baseline=${baselineHeap}, max=${maxMainFrameHeap}, growth=${heapGrowth}, heartbeatTicks=${heartbeatTicks}`,
  );
  expect(result?.thumbnailWidth).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE);
  expect(result?.thumbnailHeight).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE);
  expect(result?.thumbnailDataUrlLength).toBeLessThanOrEqual(THUMBNAIL_MAX_DATA_URL_LENGTH);
  expect(lumaEdges).toEqual({ first: 255, last: 255 });
  expect(heartbeatTicks).toBeGreaterThan(10);
  expect(heapGrowth).toBeLessThan(128 * 1024 * 1024);
  expect(workerUrls.some((url) => url.includes('png-import-worker'))).toBe(true);
});

async function importedAssetState(page: import('@playwright/test').Page): Promise<{
  readonly objectCount: number;
  readonly source: {
    readonly state: string;
    readonly byteLength: number;
    readonly pageCount: number;
  };
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly sampledWidth: number;
  readonly sampledHeight: number;
  readonly luma: {
    readonly state: string;
    readonly byteLength: number;
    readonly pageCount: number;
  };
  readonly hasDataUrl: boolean;
  readonly hasLumaBase64: boolean;
  readonly thumbnailWidth: number;
  readonly thumbnailHeight: number;
  readonly thumbnailDataUrlLength: number;
} | null> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const store = (await import(/* @vite-ignore */ storePath)) as {
      useStore: {
        getState(): {
          readonly project: {
            readonly scene: {
              readonly objects: readonly Record<string, unknown>[];
            };
          };
        };
      };
    };
    const repositories = (await import(/* @vite-ignore */ repositoryPath)) as {
      IndexedDbPagedAssetRepository: new () => {
        readManifest(assetId: string): Promise<{
          readonly state: string;
          readonly byteLength: number;
          readonly pageCount: number;
        } | null>;
      };
    };
    const objects = store.useStore.getState().project.scene.objects;
    const image = objects.find((object) => object['source'] === 'qualified-200-mib.png');
    const asset = image?.['imageAsset'];
    if (typeof asset !== 'object' || asset === null) return null;
    const fields = asset as Record<string, unknown>;
    const sourceAssetId = fields['sourceAssetId'];
    const lumaAssetId = fields['lumaAssetId'];
    const thumbnail = fields['thumbnail'];
    if (typeof sourceAssetId !== 'string' || typeof lumaAssetId !== 'string') return null;
    const repository = new repositories.IndexedDbPagedAssetRepository();
    const source = await repository.readManifest(sourceAssetId);
    const luma = await repository.readManifest(lumaAssetId);
    if (source === null || luma === null) return null;
    const thumbnailDataUrl =
      typeof thumbnail === 'object' && thumbnail !== null
        ? (thumbnail as Record<string, unknown>)['dataUrl']
        : undefined;
    const thumbnailWidth =
      typeof thumbnail === 'object' && thumbnail !== null
        ? (thumbnail as Record<string, unknown>)['width']
        : undefined;
    const thumbnailHeight =
      typeof thumbnail === 'object' && thumbnail !== null
        ? (thumbnail as Record<string, unknown>)['height']
        : undefined;
    return {
      objectCount: objects.length,
      source,
      luma,
      naturalWidth: fields['naturalWidth'] as number,
      naturalHeight: fields['naturalHeight'] as number,
      sampledWidth: fields['sampledWidth'] as number,
      sampledHeight: fields['sampledHeight'] as number,
      hasDataUrl: typeof image?.['dataUrl'] === 'string',
      hasLumaBase64: typeof image?.['lumaBase64'] === 'string',
      thumbnailWidth: typeof thumbnailWidth === 'number' ? thumbnailWidth : -1,
      thumbnailHeight: typeof thumbnailHeight === 'number' ? thumbnailHeight : -1,
      thumbnailDataUrlLength: typeof thumbnailDataUrl === 'string' ? thumbnailDataUrl.length : -1,
    };
  });
}

async function mainFrameHeapBytes(cdp: import('@playwright/test').CDPSession): Promise<number> {
  const metrics = (await cdp.send('Performance.getMetrics')) as {
    readonly metrics: readonly { readonly name: string; readonly value: number }[];
  };
  const value = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value;
  if (value === undefined) throw new Error('Chrome did not report main-frame JS heap usage.');
  return value;
}

async function sampledLumaEdges(
  page: import('@playwright/test').Page,
): Promise<{ readonly first: number; readonly last: number } | null> {
  return page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const repositoryPath = '/src/ui/import/paged-asset-indexeddb.ts';
    const store = (await import(/* @vite-ignore */ storePath)) as {
      useStore: {
        getState(): {
          readonly project: {
            readonly scene: { readonly objects: readonly Record<string, unknown>[] };
          };
        };
      };
    };
    const repositories = (await import(/* @vite-ignore */ repositoryPath)) as {
      IndexedDbPagedAssetRepository: new () => {
        readManifest(assetId: string): Promise<{ readonly pageCount: number } | null>;
        readPage(assetId: string, index: number): Promise<Blob | null>;
      };
    };
    const image = store.useStore
      .getState()
      .project.scene.objects.find((object) => object['source'] === 'qualified-200-mib.png');
    const asset = image?.['imageAsset'];
    if (typeof asset !== 'object' || asset === null) return null;
    const lumaAssetId = (asset as Record<string, unknown>)['lumaAssetId'];
    if (typeof lumaAssetId !== 'string') return null;
    const repository = new repositories.IndexedDbPagedAssetRepository();
    const manifest = await repository.readManifest(lumaAssetId);
    if (manifest === null || manifest.pageCount < 1) return null;
    const firstPage = await repository.readPage(lumaAssetId, 0);
    const lastPage = await repository.readPage(lumaAssetId, manifest.pageCount - 1);
    if (firstPage === null || lastPage === null) return null;
    const firstBytes = new Uint8Array(await firstPage.arrayBuffer());
    const lastBytes = new Uint8Array(await lastPage.arrayBuffer());
    return {
      first: firstBytes[0] ?? -1,
      last: lastBytes[lastBytes.byteLength - 1] ?? -1,
    };
  });
}
