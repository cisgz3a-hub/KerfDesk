import { expect, test } from '@playwright/test';

const FIELD_WIDTH = 2_048;
const FIELD_HEIGHT = 2_048;
const SAMPLE_BYTE_COUNT = FIELD_WIDTH * FIELD_HEIGHT * 2;
const PROJECT_NOTE = 'real browser large autosave recovery';

test('real IndexedDB autosave restores a 2048x2048 canonical field after reload', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');

  const written = await page.evaluate(
    async ({ fieldWidth, fieldHeight, sampleByteCount, projectNote }) => {
      interface SceneApi {
        readonly createProject: () => {
          readonly scene: { readonly objects: readonly unknown[] };
          readonly [key: string]: unknown;
        };
        readonly DEFAULT_RELIEF_LAYER_COLOR: string;
        readonly IDENTITY_TRANSFORM: object;
      }
      interface ReliefApi {
        readonly createReliefHeightfield: (input: object) => {
          readonly digest: string;
          readonly samplesBase64: string;
          readonly [key: string]: unknown;
        };
      }
      interface AutosaveApi {
        readonly projectAutosaveService: {
          write(
            project: object,
            savedAt?: number,
          ): Promise<{
            readonly kind: string;
            readonly backend?: string;
          }>;
        };
      }

      const scenePath = '/src/core/scene/index.ts';
      const reliefPath = '/src/core/relief/relief-heightfield-factory.ts';
      const autosavePath = '/src/ui/state/autosave-durable.ts';
      const scene = (await import(/* @vite-ignore */ scenePath)) as SceneApi;
      const relief = (await import(/* @vite-ignore */ reliefPath)) as ReliefApi;
      const autosave = (await import(/* @vite-ignore */ autosavePath)) as AutosaveApi;
      const samples = new Uint8Array(sampleByteCount);
      samples.fill(0xff);
      samples[0] = 0;
      samples[1] = 0;
      samples[sampleByteCount / 2] = 0x34;
      samples[sampleByteCount / 2 + 1] = 0x12;
      const source = relief.createReliefHeightfield({
        width: fieldWidth,
        height: fieldHeight,
        physicalWidthMm: 204.8,
        physicalHeightMm: 204.8,
        samples,
        mapping: {
          polarity: 'light-is-high',
          inputLowCode: 0,
          inputHighCode: 0xffff,
          curve: { kind: 'gamma-v1', gamma: 1 },
          maxDepthMm: 8,
          crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
          aspect: 'preserve',
          inclusionThreshold: 255,
          outsideMask: 'excluded',
        },
        provenance: {
          sourceKind: 'depth-map',
          sourceName: 'large-heightfield.png',
          sourceBitDepth: 16,
          sourcePolarity: 'light-is-high',
        },
      });
      const empty = scene.createProject();
      const project = {
        ...empty,
        notes: projectNote,
        scene: {
          ...empty.scene,
          objects: [
            {
              kind: 'relief',
              id: 'large-heightfield-relief',
              source: 'large-heightfield.png',
              targetWidthMm: 204.8,
              reliefDepthMm: 8,
              reliefSource: source,
              color: scene.DEFAULT_RELIEF_LAYER_COLOR,
              bounds: { minX: 0, minY: 0, maxX: 204.8, maxY: 204.8 },
              transform: scene.IDENTITY_TRANSFORM,
            },
          ],
        },
      };
      const result = await autosave.projectAutosaveService.write(project, Date.now());
      return {
        result,
        digest: source.digest,
        base64Length: source.samplesBase64.length,
        localAutosaveKeys: Object.keys(localStorage).filter(
          (key) => key === 'lf2:autosave:v1' || key.startsWith('lf2:autosave:v1:'),
        ),
      };
    },
    {
      fieldWidth: FIELD_WIDTH,
      fieldHeight: FIELD_HEIGHT,
      sampleByteCount: SAMPLE_BYTE_COUNT,
      projectNote: PROJECT_NOTE,
    },
  );

  expect(written.result).toMatchObject({ kind: 'ok', backend: 'indexeddb' });
  expect(written.base64Length).toBe(Math.ceil(SAMPLE_BYTE_COUNT / 3) * 4);
  expect(written.localAutosaveKeys).toEqual([]);

  let recoveryPrompt = '';
  page.once('dialog', async (dialog) => {
    recoveryPrompt = dialog.message();
    await dialog.accept();
  });
  await page.reload();

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const statePath = '/src/ui/state/index.ts';
          const loaded: unknown = await import(/* @vite-ignore */ statePath);
          const state = loaded as {
            readonly useStore?: {
              getState(): { readonly project: { readonly notes: string }; readonly dirty: boolean };
            };
          };
          return state.useStore?.getState().project.notes ?? null;
        }),
      { timeout: 30_000 },
    )
    .toBe(PROJECT_NOTE);

  const recovered = await page.evaluate(async () => {
    const statePath = '/src/ui/state/index.ts';
    const autosavePath = '/src/ui/state/autosave-durable.ts';
    const loaded: unknown = await import(/* @vite-ignore */ statePath);
    const autosave = (await import(/* @vite-ignore */ autosavePath)) as {
      readonly projectAutosaveService: {
        readLatest(): Promise<{
          readonly warnings: readonly string[];
          readonly snapshot: null | {
            readonly backend: string;
            readonly project: {
              readonly scene: {
                readonly objects: readonly {
                  readonly reliefSource?: { readonly digest: string };
                }[];
              };
            };
          };
        }>;
        stop(): Promise<void>;
      };
    };
    const state = loaded as {
      readonly useStore: {
        getState(): {
          readonly dirty: boolean;
          readonly project: {
            readonly scene: {
              readonly objects: readonly {
                readonly kind: string;
                readonly reliefSource?: {
                  readonly kind: string;
                  readonly width: number;
                  readonly height: number;
                  readonly digest: string;
                  readonly samplesBase64: string;
                };
              }[];
            };
          };
        };
        setState(update: { readonly dirty: boolean }): void;
      };
    };
    const store = state.useStore.getState();
    const source = store.project.scene.objects[0]?.reliefSource;
    const durable = await autosave.projectAutosaveService.readLatest();
    const durableSource = durable.snapshot?.project.scene.objects[0]?.reliefSource;
    state.useStore.setState({ dirty: false });
    await autosave.projectAutosaveService.stop();
    return {
      dirty: store.dirty,
      kind: source?.kind,
      width: source?.width,
      height: source?.height,
      digest: source?.digest,
      base64Length: source?.samplesBase64.length,
      durableBackend: durable.snapshot?.backend,
      durableWarnings: durable.warnings,
      durableDigest: durableSource?.digest,
    };
  });

  expect(recoveryPrompt).toContain('CurveDesk found an auto-saved project');
  expect(recovered).toEqual({
    dirty: true,
    kind: 'heightfield-v1',
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    digest: written.digest,
    base64Length: written.base64Length,
    durableBackend: 'indexeddb',
    durableWarnings: [],
    durableDigest: written.digest,
  });
});
