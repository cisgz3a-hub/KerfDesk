import { afterEach, describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc';
import { collectLayerContours } from '../../core/cnc/collect-cnc-contours';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const COLOR = '#ff0000';
const OTHER_COLOR = '#0000ff';
const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'profile-on-path',
  depthMm: 6,
  depthPerPassMm: 6,
  tabHeightMm: 2,
  tabWidthMm: 2,
  tabsPerShape: 4,
  profileLead: { shape: 'none' },
};
const OPERATION = { ...createLayer({ id: 'profile', color: COLOR }), cnc: SETTINGS };
const OTHER = { ...createLayer({ id: 'other', color: COLOR }), cnc: SETTINGS };

afterEach(resetStore);

function square(id: string, operationIds: ReadonlyArray<string> = [OPERATION.id]): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds,
    bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 60, y: 20 },
              { x: 60, y: 60 },
              { x: 20, y: 60 },
            ],
          },
        ],
      },
    ],
    cncTabAnchors: [0.05, 0.3, 0.55, 0.8].map((pathT) => ({
      layerColor: COLOR,
      pathIndex: 0,
      polylineIndex: 0,
      pathT,
    })),
  };
}

function install(
  objects: ReadonlyArray<ImportedSvg>,
  layers: ReadonlyArray<Layer> = [OPERATION, OTHER],
): void {
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects, layers },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function change(patch: Partial<CncLayerSettings>): void {
  useStore.getState().setLayerParam(OPERATION.id, { cnc: { ...SETTINGS, ...patch } });
}

function tabRises(scene: Scene): number {
  const project = useStore.getState().project;
  const job = compileCncJob(scene, project.device, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('CNC group missing');
  return group.passes.reduce((total, pass) => {
    if (pass.kind !== 'path3d') return total;
    return (
      total +
      pass.points.filter((point, index) => index > 0 && point.z > pass.points[index - 1]!.z + 1e-9)
        .length
    );
  }, 0);
}

describe('CNC operation tab-count transaction', () => {
  it('updates all independently bound unlocked objects, preserving unrelated and locked objects', () => {
    const objects = [
      square('selected'),
      square('unselected'),
      square('other', [OTHER.id]),
      { ...square('locked'), locked: true },
    ];
    install(objects);
    change({ tabsPerShape: 6 });
    const scene = useStore.getState().project.scene;
    expect(scene.objects.map((object) => object.cncTabAnchors?.length)).toEqual([6, 6, 4, 4]);
    expect(scene.objects[2]).toBe(objects[2]);
    expect(scene.objects[3]).toBe(objects[3]);
    expect(scene.layers[1]).toBe(OTHER);
    expect(scene.objects[0]?.operationIds).toEqual([OPERATION.id]);
  });

  it('honors explicit path bindings and multiple path colors without resyncing same-color siblings', () => {
    const base = square('mixed', [OTHER.id]);
    const path = base.paths[0]!;
    const paths = [
      { ...path, operationIds: [OPERATION.id] },
      { ...path, operationIds: [OTHER.id] },
      { ...path, color: OTHER_COLOR, operationIds: [OPERATION.id] },
    ];
    const anchors = paths.flatMap((entry, pathIndex) =>
      base.cncTabAnchors!.map((anchor) => ({ ...anchor, pathIndex, layerColor: entry.color })),
    );
    install([{ ...base, paths, cncTabAnchors: anchors }]);
    change({ tabsPerShape: 6 });
    const object = useStore.getState().project.scene.objects[0]!;
    expect(
      [0, 1, 2].map(
        (pathIndex) =>
          object.cncTabAnchors?.filter((anchor) => anchor.pathIndex === pathIndex).length,
      ),
    ).toEqual([6, 4, 6]);
    expect(object.cncTabAnchors?.filter((anchor) => anchor.pathIndex === 1)).toEqual(
      anchors.filter((anchor) => anchor.pathIndex === 1),
    );
    expect('paths' in object && object.paths).toBe(paths);
  });

  it('preserves anchors shared by two operations while updating the independent path', () => {
    const shared = square('shared', [OPERATION.id, OTHER.id]);
    const independent = square('independent');
    install([shared, independent]);
    const before = useStore.getState().project;
    const otherBefore = collectLayerContours(before.scene.objects, OTHER, before.device);
    change({ tabsPerShape: 6 });
    const after = useStore.getState().project;
    expect(after.scene.objects[0]).toBe(shared);
    expect(after.scene.objects[1]?.cncTabAnchors).toHaveLength(6);
    expect(collectLayerContours(after.scene.objects, OTHER, after.device)).toEqual(otherBefore);
    expect(after.scene.layers[0]?.cnc?.tabsPerShape).toBe(6);
    expect(useStore.getState().undoStack).toEqual([before]);
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toEqual(after);
  });

  it.each([{ tabsEnabled: false }, { tabHeightMm: 3 }, { tabsPerShape: 4 }])(
    'keeps dragged positions for a non-count edit %j',
    (patch) => {
      const object = square('part');
      install([object]);
      change(patch);
      expect(useStore.getState().project.scene.objects[0]).toBe(object);
    },
  );

  it.each(['pocket', 'inlay-pair'] as const)(
    'does not reseed saved profile anchors for %s settings',
    (cutType) => {
      const object = square('part');
      install([object]);
      change({ cutType, tabsPerShape: 6 });
      expect(useStore.getState().project.scene.objects[0]).toBe(object);
    },
  );

  it('keeps untouched contours automatic and legacy color membership compatible', () => {
    const { cncTabAnchors: _anchors, ...automatic } = square('automatic');
    const { operationIds: _ids, ...legacy } = square('legacy');
    install([automatic, legacy], [OPERATION]);
    change({ tabsPerShape: 6 });
    expect(useStore.getState().project.scene.objects[0]).toBe(automatic);
    expect(useStore.getState().project.scene.objects[1]?.cncTabAnchors).toHaveLength(6);
  });

  it('compiles the changed tab count for a matching-color path and restores it with undo/redo', () => {
    install([square('part')], [OPERATION]);
    expect(tabRises(useStore.getState().project.scene)).toBe(4);
    change({ tabsPerShape: 6 });
    expect(tabRises(useStore.getState().project.scene)).toBe(6);
    useStore.getState().undo();
    expect(tabRises(useStore.getState().project.scene)).toBe(4);
    useStore.getState().redo();
    expect(tabRises(useStore.getState().project.scene)).toBe(6);
  });
});
