import { beforeEach, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  operationIdsForObject,
  type SceneObject,
} from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import {
  capturePersonalArtwork,
  filterPersonalArtwork,
  insertPersonalArtwork,
  personalArtworkProject,
} from './personal-artwork-model';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import { artworkProject, assetReader, pagedProject } from './personal-artwork-test-fixtures';

beforeEach(() => resetStore());

function select(project = artworkProject()): void {
  useStore.setState({
    project,
    selectedObjectId: 'text',
    additionalSelectedIds: new Set(['image']),
  });
}

it('saves a grouped editable logo with mask/path dependencies, embedded font and associated settings', async () => {
  select();
  const entry = await capturePersonalArtwork(useStore.getState(), ' Logo ', 'Jigs');
  const project = personalArtworkProject(entry);
  expect(entry).toMatchObject({
    name: 'Logo',
    category: 'Jigs',
    selectedObjectIds: ['text', 'image'],
  });
  expect(project.scene.objects.map((object) => object.id)).toEqual(['mask', 'text', 'image']);
  expect(project.scene.groups).toEqual(artworkProject().scene.groups);
  expect(project.scene.layers.map((layer) => layer.id)).toEqual(['cut', 'engrave', 'image-op']);
  expect(project.scene.objects.find((object) => object.kind === 'text')).toMatchObject({
    content: 'Editable logo',
    fontKey: 'embedded:logo',
  });
  expect(project.embeddedFonts).toEqual(artworkProject().embeddedFonts);
  expect(project.scene.objects.find((object) => object.kind === 'raster-image')).toMatchObject({
    dataUrl: 'data:image/png;base64,AQIDBA==',
    lumaBase64: 'AECA/w==',
  });
  expect(parsePersonalArtworkLibrary(serializePersonalArtworkLibrary([entry]))).toEqual([entry]);
});

it('inserts new object/group/operation/font identities into a colliding project with one undo', async () => {
  select();
  const entry = await capturePersonalArtwork(useStore.getState(), 'Logo', 'Jigs');
  const original = artworkProject();
  const destination = {
    ...original,
    notes: 'Keep destination',
    embeddedFonts: [{ key: 'embedded:logo', fileName: 'Other.otf', dataBase64: 'T1RUTwEBAQE=' }],
    scene: {
      ...original.scene,
      layers: original.scene.layers.map((layer) => ({ ...layer, speed: 999 })),
    },
  };
  useStore.setState({ project: destination, undoStack: [], redoStack: [] });
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const inserted = useStore.getState().project;
  const added = inserted.scene.objects.slice(3);
  expect(added).toHaveLength(3);
  expect(new Set(inserted.scene.objects.map((object) => object.id)).size).toBe(6);
  expect(new Set(inserted.scene.groups?.map((group) => group.id)).size).toBe(2);
  expect(added[0]?.transform).toEqual(original.scene.objects[0]?.transform);
  expect(inserted.device).toBe(destination.device);
  expect(inserted.notes).toBe('Keep destination');
  const text = added.find((object) => object.kind === 'text');
  if (text?.kind !== 'text') throw new Error('text missing');
  expect(text.fontKey).not.toBe('embedded:logo');
  expect(inserted.embeddedFonts).toContainEqual(
    expect.objectContaining({ key: text.fontKey, dataBase64: 'T1RUTwAAAAA=' }),
  );
  expect(text.pathText?.guideObjectId).toBe(added[0]?.id);
  const image = added.find((object) => object.kind === 'raster-image');
  expect(image).toMatchObject({ imageMaskId: added[0]?.id });
  expect(
    inserted.scene.layers.find(
      (layer) => layer.id === operationIdsForObject(text, inserted.scene.layers)[0],
    )?.speed,
  ).toBe(456);
  expect(inserted.scene.layers.find((layer) => layer.id === 'engrave')?.speed).toBe(999);
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(prepareProjectForPersistence(inserted).kind).toBe('ok');
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(destination);
  useStore.getState().redo();
  expect(useStore.getState().project).toBe(inserted);
});

it.each(['operations', 'artwork'] as const)(
  'refuses insertion atomically when its %s would exceed the saved-project budget',
  async (budget) => {
    select();
    const entry = await capturePersonalArtwork(useStore.getState(), 'Logo', 'Jigs');
    const source = artworkProject();
    const project = {
      ...createProject(),
      scene: {
        objects:
          budget === 'artwork'
            ? Array.from({ length: PROJECT_SCENE_LIMITS.objects }, (_, index) => ({
                ...source.scene.objects[0]!,
                id: `existing-${index}`,
              }))
            : [],
        layers:
          budget === 'operations'
            ? Array.from({ length: PROJECT_SCENE_LIMITS.layers - 2 }, (_, index) =>
                createLayer({
                  id: `existing-operation-${index}`,
                  color: `#${index.toString(16).padStart(6, '0')}`,
                }),
              )
            : [source.scene.layers[0]!],
        groups: [],
      },
    };
    expect(prepareProjectForPersistence(project).kind).toBe('ok');
    useStore.setState({ project, undoStack: [source], redoStack: [source], dirty: false });
    const before = useStore.getState();
    expect(() => useStore.setState((state) => insertPersonalArtwork(state, entry))).toThrow(
      'exceed the project limits',
    );
    expect(useStore.getState()).toBe(before);
  },
);

it('allows insertion that exactly fills the saved-project operation budget', async () => {
  select();
  const entry = await capturePersonalArtwork(useStore.getState(), 'Logo', '');
  const project = {
    ...createProject(),
    scene: {
      objects: [],
      layers: Array.from({ length: PROJECT_SCENE_LIMITS.layers - 3 }, (_, index) =>
        createLayer({
          id: `existing-operation-${index}`,
          color: `#${index.toString(16).padStart(6, '0')}`,
        }),
      ),
      groups: [],
    },
  };
  useStore.setState({ project });
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const inserted = useStore.getState().project;
  expect(inserted.scene.layers).toHaveLength(PROJECT_SCENE_LIMITS.layers);
  expect(prepareProjectForPersistence(inserted).kind).toBe('ok');
});

it('captures original paged PNG bytes and full luma so export/import needs no source database', async () => {
  select(pagedProject());
  const reader = assetReader();
  const acquire = vi.spyOn(reader, 'acquireReadLease');
  const release = vi.spyOn(reader, 'releaseReadLease');
  const entry = await capturePersonalArtwork(useStore.getState(), 'Photo jig', 'Jigs', reader);
  const imported = parsePersonalArtworkLibrary(serializePersonalArtworkLibrary([entry]))[0]!;
  expect(imported.projectJson).not.toContain('sourceAssetId');
  expect(imported.projectJson).toContain('data:image/png;base64,AQIDBA==');
  expect(imported.projectJson).toContain('AECA/w==');
  expect(acquire).toHaveBeenCalledWith(['source', 'luma'], expect.any(String));
  expect(release).toHaveBeenCalledWith(['source', 'luma'], expect.any(String));
  useStore.setState({ project: createProject() });
  useStore.setState((state) => insertPersonalArtwork(state, imported));
  expect(useStore.getState().project.scene.objects).toHaveLength(3);
});

it('does not save a partial item if image pages fail, and releases its read lease', async () => {
  select(pagedProject());
  const reader = assetReader();
  const release = vi.spyOn(reader, 'releaseReadLease');
  vi.spyOn(reader, 'readManifest').mockResolvedValue(null);
  await expect(capturePersonalArtwork(useStore.getState(), 'Failed', '', reader)).rejects.toThrow(
    'unavailable',
  );
  expect(release).toHaveBeenCalled();
});

it('rejects missing editable font bytes and malformed library identities', async () => {
  select({ ...artworkProject(), embeddedFonts: [] });
  await expect(capturePersonalArtwork(useStore.getState(), 'Logo', '')).rejects.toThrow(
    'Embed the missing font',
  );
  select();
  const entry = await capturePersonalArtwork(useStore.getState(), 'Logo', 'Jigs');
  expect(() =>
    parsePersonalArtworkLibrary(serializePersonalArtworkLibrary([entry, entry])),
  ).toThrow('Duplicate');
  expect(() => parsePersonalArtworkLibrary('{}')).toThrow('supported');
});

it('matches names/categories without changing the stored collection', async () => {
  select();
  const one = await capturePersonalArtwork(useStore.getState(), 'Circle logo', 'Jigs');
  const two = { ...one, id: 'second', name: 'School stamp', category: 'School' };
  expect(filterPersonalArtwork([one, two], 'LOGO', '')).toEqual([one]);
  expect(filterPersonalArtwork([one, two], '', 'School')).toEqual([two]);
});

it('preserves separate multi-operation associations even when destination settings match', async () => {
  const project = artworkProject();
  const second = { ...project.scene.layers[0]!, id: 'second-pass', color: '#00ff00' };
  const objects = project.scene.objects.map(
    (object): SceneObject =>
      object.id === 'mask' ? { ...object, operationIds: ['cut', second.id] } : object,
  );
  select({
    ...project,
    scene: { ...project.scene, objects, layers: [...project.scene.layers, second] },
  });
  const entry = await capturePersonalArtwork(useStore.getState(), 'Twice', '');
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const scene = useStore.getState().project.scene;
  const mask = scene.objects[3]!;
  expect(operationIdsForObject(mask, scene.layers)).toHaveLength(2);
  expect(operationIdsForObject(mask, scene.layers)).not.toContain('cut');
  expect(operationIdsForObject(mask, scene.layers)).not.toContain('second-pass');
});

it('preserves custom CNC bits across colliding tool IDs without replacing destination machine settings', async () => {
  const project = artworkProject();
  const bit = { ...DEFAULT_CNC_MACHINE_CONFIG.tools[0]!, id: 'same-bit', diameterMm: 2 };
  const machine = { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [bit], toolId: bit.id };
  select({
    ...project,
    machine,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: bit.id, depthMm: 3 },
      })),
    },
  });
  const entry = await capturePersonalArtwork(useStore.getState(), 'CNC jig', 'Jigs');
  const destination = {
    ...createProject(),
    machine: { ...machine, tools: [{ ...bit, diameterMm: 10 }] },
  };
  useStore.setState({ project: destination });
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const inserted = useStore.getState().project;
  if (inserted.machine?.kind !== 'cnc') throw new Error('CNC configuration missing');
  const toolId = inserted.scene.layers[0]?.cnc?.toolId;
  expect(toolId).not.toBe(bit.id);
  expect(inserted.machine.toolId).toBe(bit.id);
  expect(inserted.machine.tools.find((tool) => tool.id === toolId)?.diameterMm).toBe(2);
  expect(inserted.machine.stock).toBe(destination.machine.stock);
});

it('retains output ordering and reuses already embedded font bytes on repeated insertion', async () => {
  const project = artworkProject();
  select({ ...project, scene: { ...project.scene, artworkOrder: ['image', 'text', 'mask'] } });
  const entry = await capturePersonalArtwork(useStore.getState(), 'Ordered logo', '');
  useStore.setState({ project: createProject() });
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const first = useStore.getState().project;
  expect(first.scene.artworkOrder).toEqual([
    first.scene.objects[2]?.id,
    first.scene.objects[1]?.id,
    first.scene.objects[0]?.id,
  ]);
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const twice = useStore.getState().project;
  expect(twice.embeddedFonts).toHaveLength(1);
  expect(new Set(twice.scene.objects.map((object) => object.id)).size).toBe(6);
});

it('carries a traced object original bitmap even when only the trace is selected', async () => {
  const project = artworkProject();
  const mask = project.scene.objects[0]!;
  if (!('paths' in mask)) throw new Error('fixture paths missing');
  const trace = {
    kind: 'traced-image' as const,
    id: 'trace',
    source: 'traced.png',
    paths: mask.paths,
    bounds: mask.bounds,
    transform: mask.transform,
    operationIds: ['cut'],
    traceSourceId: 'image',
  };
  useStore.setState({
    project: {
      ...project,
      scene: { ...project.scene, objects: [...project.scene.objects, trace] },
    },
    selectedObjectId: trace.id,
    additionalSelectedIds: new Set(),
  });
  const entry = await capturePersonalArtwork(useStore.getState(), 'Traced logo', '');
  const saved = personalArtworkProject(entry);
  expect(saved.scene.objects.map((object) => object.id)).toEqual(['mask', 'image', 'trace']);
  useStore.setState({ project: createProject() });
  useStore.setState((state) => insertPersonalArtwork(state, entry));
  const added = useStore.getState().project.scene.objects;
  expect(added[2]).toMatchObject({ traceSourceId: added[1]?.id });
});
