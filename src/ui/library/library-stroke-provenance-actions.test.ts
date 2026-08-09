import { beforeEach, describe, expect, it } from 'vitest';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { cncGrblStrategy } from '../../core/output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncTool,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { TABLER_LIBRARY_ENTRIES } from './design-library-tabler';
import { librarySvgObjectFor } from './library-entry-insert';

const APPLE_TITLE = 'Apple';
const VBIT: CncTool = {
  id: 'library-action-v30',
  name: '30 degree V-bit',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 30,
};

type VCarveEvidence = {
  readonly gcode: string;
  readonly pointDepths: ReadonlyArray<number>;
};

describe('library stroke provenance through vector actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('keeps Apple V-carve motion after Convert to Path', async () => {
    const fixture = await appleFixture('apple-convert-to-path');
    loadScene(fixture.scene, fixture.object.id);

    useStore.getState().convertSelectionToPath();

    const convertedScene = useStore.getState().project.scene;
    expect(allPathsKeepStrokeWidth(convertedScene)).toBe(true);
    expectVCarveMotion(convertedScene);
  });

  it('keeps Apple V-carve motion after Break Apart', async () => {
    const fixture = await appleFixture('apple-break-apart');
    loadScene(fixture.scene, fixture.object.id);

    useStore.getState().breakApartSelection();

    const splitScene = useStore.getState().project.scene;
    expect(splitScene.objects.length).toBeGreaterThan(1);
    expect(allPathsKeepStrokeWidth(splitScene)).toBe(true);
    expectVCarveMotion(splitScene);
  });
});

function expectVCarveMotion(scene: Scene): void {
  const evidence = compileEvidence(scene);
  expect(evidence.pointDepths.length).toBeGreaterThan(0);
  expect(Math.min(...evidence.pointDepths)).toBeLessThan(0);
  expect(evidence.gcode).toMatch(/^G1?X-?\d+\.\d{3}Y-?\d+\.\d{3}Z-?\d+\.\d{3}/m);
}

async function appleFixture(
  objectId: string,
): Promise<{ readonly object: ImportedSvg; readonly scene: Scene }> {
  const entry = TABLER_LIBRARY_ENTRIES.find(({ title }) => title === APPLE_TITLE);
  if (entry === undefined) throw new Error('Expected the bundled Apple entry.');
  const object = await librarySvgObjectFor(entry, objectId);
  if (object === null) throw new Error('Expected the Apple SVG object.');
  const color = object.paths[0]?.color;
  if (color === undefined) throw new Error('Expected the Apple path color.');
  return { object, scene: sceneFor(object, vCarveLayer(color)) };
}

function vCarveLayer(color: string): Layer {
  return {
    ...createLayer({ id: 'library-action-vcarve', color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve',
      depthMm: 3,
      depthPerPassMm: 0.5,
      vResolutionMm: 0.1,
    },
  };
}

function sceneFor(object: ImportedSvg, layer: Layer): Scene {
  return { objects: [object], layers: [layer] };
}

function loadScene(scene: Scene, selectedObjectId: string): void {
  useStore.setState({
    project: { ...createProject(), scene },
    selectedObjectId,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
}

function allPathsKeepStrokeWidth(scene: Scene): boolean {
  return scene.objects.every(
    (object) =>
      !('paths' in object) ||
      object.paths.every((path) => path.strokeWidthMm !== undefined && path.strokeWidthMm > 0),
  );
}

function compileEvidence(scene: Scene): VCarveEvidence {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [VBIT],
    toolId: VBIT.id,
  });
  const pointDepths = job.groups.flatMap((group) =>
    group.kind === 'cnc' && group.cutType === 'v-carve'
      ? group.passes.flatMap((pass) =>
          pass.kind === 'path3d' ? pass.points.map((point) => point.z) : [],
        )
      : [],
  );
  return {
    gcode: cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE),
    pointDepths,
  };
}
