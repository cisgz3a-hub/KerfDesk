import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRemoteControlAdapter } from './adapter';
import { useStore } from '../state/store';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { createLayer } from '../../core/scene';
import type { RemoteControlAdapter, SafeRemoteJobReview } from './types';
import { captureMaterialRecipe } from '../../core/material-library';

const APP = {
  app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop', filePath: 'C:/private/app' },
  edition: {
    mode: 'trial',
    trialEndsAt: '2026-11-01T00:00:00Z',
    licenseKey: 'KD1.private-license',
  },
  updates: { available: true, version: '1.0.4', paymentToken: 'private-payment' },
} as const;
let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  adapter = createRemoteControlAdapter({ getAppStatus: () => APP, canWrite: () => false });
});
afterEach(() => adapter.dispose());
async function read(command: string) {
  const result = await adapter.execute(command, {});
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error('Expected projected result');
  return result.data;
}

describe('remote snapshots expose only the agreed metadata', () => {
  it('does not expose path or credential shaped identifiers from imported documents', async () => {
    const state = useStore.getState();
    const object = createRectangle({
      id: 'C:/private/source.svg',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
    });
    useStore.setState({
      selectedObjectId: object.id,
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [object],
          layers: [createLayer({ id: 'KD1.private-license', color: '#000000' })],
        },
      },
    });
    expect(await read('get_workspace')).toMatchObject({
      artwork: [],
      operations: [],
      selection: [],
      totalArtwork: 1,
      totalOperations: 1,
      truncated: true,
    });
  });
  it('never spreads file, port, camera, text, profile, licence or payment payloads', async () => {
    const state = useStore.getState();
    const object = {
      ...createRectangle({
        id: 'art',
        color: '#000000',
        spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
      }),
      content: 'private-artwork-text',
      source: 'C:/private/source.svg',
    };
    useStore.setState({
      savedName: 'C:/private/project.lf2',
      project: {
        ...state.project,
        notes: 'private-notes',
        device: {
          ...state.project.device,
          serialPort: 'private-port',
          camera: { token: 'private-camera' },
        } as typeof state.project.device,
        scene: {
          ...state.project.scene,
          objects: [object],
          layers: [createLayer({ id: 'operation', color: '#000000' })],
        },
      },
    });
    const workspace = await read('get_workspace');
    expect(workspace['name']).toBe('Current workspace');
    expect(workspace['artwork']).toEqual([
      {
        id: 'art',
        type: 'shape',
        visible: true,
        editable: true,
        bounds: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 20 },
        operationId: 'operation',
      },
    ]);
    const all = JSON.stringify([
      workspace,
      await read('get_machine'),
      await read('get_app_status'),
    ]);
    expect(all).not.toContain('private');
    expect(await read('get_app_status')).toEqual({
      app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop' },
      edition: { mode: 'trial', trialEndsAt: '2026-11-01T00:00:00Z' },
      updates: { available: true, version: '1.0.4' },
    });
  });

  it('bounds large workspaces and recipe libraries without inventing totals', async () => {
    const objects = Array.from({ length: 205 }, (_, index) =>
      createRectangle({
        id: `art-${index}`,
        color: '#000000',
        spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
      }),
    );
    const layers = Array.from({ length: 203 }, (_, index) =>
      createLayer({ id: `operation-${index}`, color: '#000000' }),
    );
    const state = useStore.getState();
    useStore.setState({
      project: { ...state.project, scene: { ...state.project.scene, objects, layers } },
    });
    useStore.getState().setMaterialLibrary({
      format: 'laserforge-material-library',
      librarySchemaVersion: 2,
      libraryId: 'library',
      name: 'Materials',
      entries: Array.from({ length: 207 }, (_, index) => ({
        id: `recipe-${index}`,
        materialName: 'Plywood',
        description: 'private description',
        revision: 'revision',
        recipe: captureMaterialRecipe(layers[0]!),
      })),
    });
    const workspace = await read('get_workspace');
    expect(workspace).toMatchObject({ totalArtwork: 205, totalOperations: 203, truncated: true });
    expect(workspace['artwork']).toHaveLength(200);
    expect(workspace['operations']).toHaveLength(200);
    const library = await read('list_material_recipes');
    expect(library).toMatchObject({ total: 207, truncated: true });
    expect(library['recipes']).toHaveLength(200);
    expect(JSON.stringify(library)).not.toContain('private');
    expect(new TextEncoder().encode(JSON.stringify(workspace)).length).toBeLessThan(256 * 1024);
  });

  it('does not fabricate review readiness or reuse stale Frame proof', async () => {
    expect(await read('review_job')).toEqual({
      status: 'unavailable',
      mode: 'laser',
      warnings: [],
      frame: { required: true, complete: false },
    });
    let review: SafeRemoteJobReview | null = null;
    adapter.dispose();
    adapter = createRemoteControlAdapter({
      getAppStatus: () => APP,
      canWrite: () => false,
      getReview: () => review,
    });
    review = {
      revision: adapter.getRevision(),
      mode: 'laser',
      status: 'ready',
      summary: { artworkCount: 1, operationCount: 1, estimatedSeconds: 42 },
      warnings: [
        { code: 'advisory', message: 'Review the material settings.', severity: 'warning' },
      ],
      frame: { required: true, complete: true },
    };
    expect(await read('review_job')).toMatchObject({ status: 'ready', frame: { complete: true } });
    useStore.getState().newProject();
    expect(await read('review_job')).toMatchObject({
      status: 'unavailable',
      frame: { complete: false },
    });
  });

  it('redacts path-like labels and omits invalid bounds instead of serializing infinities', async () => {
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        device: { ...state.project.device, name: 'C:/private/machine' },
        scene: {
          ...state.project.scene,
          objects: [
            {
              ...createRectangle({
                id: 'art',
                color: '#000000',
                spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
              }),
              bounds: { minX: 0, minY: 0, maxX: Infinity, maxY: 2 },
            },
          ],
        },
      },
    });
    expect(await read('get_machine')).toMatchObject({ machine: { name: 'Selected machine' } });
    expect((await read('get_workspace'))['artwork']).toEqual([
      { id: 'art', type: 'shape', visible: true, editable: true },
    ]);
  });
});
