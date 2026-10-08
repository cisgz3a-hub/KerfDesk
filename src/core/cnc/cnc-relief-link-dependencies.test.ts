import { describe, expect, it } from 'vitest';
import {
  testAuthoringRelief,
  testLinkedReliefDocument,
  testMaterializedRelief,
  testReliefBoundary,
} from '../../__fixtures__/relief-authoring';
import {
  createProject,
  createLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
} from '../scene';
import { projectWithRefreshedReliefLinks } from '../../ui/state/relief-link-mutation';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { cncPreparationInputs, cncDependencyStatuses } from './cnc-preparation-dependencies';
import type { Project } from '../scene/project';
import type { SceneObject, ImportedSvg } from '../scene/scene-object';
import { reliefAuthoringLinkIds } from '../relief/relief-authoring-link-ids';
function project(): Project {
  const original = testAuthoringRelief(),
    doc = testLinkedReliefDocument(original);
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [
        { ...original, reliefAuthoring: doc, reliefSource: testMaterializedRelief(doc) },
        { ...testReliefBoundary(), operationIds: [] },
        { ...testReliefBoundary('mask'), operationIds: [] },
      ],
      layers: [
        {
          ...createLayer({ id: 'relief-layer', color: '#a0522d' }),
          output: true,
          cnc: DEFAULT_CNC_LAYER_SETTINGS,
        },
      ],
    },
  };
}
describe('linked relief preparation dependency evidence', () => {
  it('marks a missing linked source dirty even while the canonical field stays available for repair', () => {
    const previous = project();
    const broken = projectWithRefreshedReliefLinks({
      ...previous,
      scene: { ...previous.scene, objects: previous.scene.objects.filter((o) => o.id !== 'mask') },
    });
    expect(prepareOutput(broken).ok).toBe(false);
    expect(broken.scene.objects[0]).toBe(previous.scene.objects[0]);
    const result = cncDependencyStatuses(
      cncPreparationInputs(broken),
      cncPreparationInputs(previous),
    );
    expect(result[0]?.status).toBe('dirty');
  });
  it('tracks invalid mask geometry that cannot replace the retained canonical field', () => {
    const previous = project();
    const mask = previous.scene.objects.find((object) => object.id === 'mask') as ImportedSvg;
    const invalid = {
      ...mask,
      paths: mask.paths.map((path) => ({
        ...path,
        polylines: path.polylines.map((line) => ({ ...line, closed: false })),
      })),
    };
    const broken = editedSource(previous, invalid);
    expect(broken.scene.objects[0]).toBe(previous.scene.objects[0]);
    expect(prepareOutput(broken).ok).toBe(false);
    expect(statuses(broken, previous)[0]?.status).toBe('dirty');
  });
  it('tracks links of an unselected target used by a selected projected vector', () => {
    const original = project(),
      target = original.scene.objects[0]!;
    const vector = { ...testReliefBoundary('vector'), operationIds: ['engrave'] };
    const previous: Project = {
      ...original,
      scene: {
        ...original.scene,
        objects: [
          { ...target, operationIds: ['relief-layer'] },
          ...original.scene.objects.slice(1),
          vector,
        ],
        layers: [
          { ...original.scene.layers[0]!, output: false },
          {
            ...createLayer({ id: 'engrave', color: '#000000' }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'engrave',
              reliefProjection: {
                reliefObjectId: 'relief',
                depthMm: 0.2,
                depthConvention: 'vertical',
                sampleSpacingMm: 0.1,
              },
            },
          },
        ],
      },
    };
    const broken = {
      ...previous,
      scene: {
        ...previous.scene,
        objects: previous.scene.objects.filter((object) => object.id !== 'mask'),
      },
    };
    const scope = {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['vector'],
    };
    const result = cncDependencyStatuses(
      cncPreparationInputs(broken, scope),
      cncPreparationInputs(previous, scope),
    );
    expect(result.map((operation) => operation.status)).toEqual(['disabled', 'dirty']);
  });
  it('keeps linked source labels, colours and output bindings ready', () => {
    const previous = project();
    const mask = previous.scene.objects.find((object) => object.id === 'mask') as ImportedSvg;
    const current = editedSource(previous, {
      ...mask,
      source: 'renamed.svg',
      name: 'Label',
      operationIds: ['unrelated'],
      paths: mask.paths.map((path) => ({ ...path, color: '#ff0000', operationIds: ['unrelated'] })),
    });
    expect(statuses(current, previous)[0]?.status).toBe('ready');
  });
  it('includes clip, level, sculpt, component and both rail links in the same live source contract', () => {
    const original = testLinkedReliefDocument();
    const linked = (linkedObjectId: string) => ({ rings: [], linkedObjectId });
    const document = {
      ...original,
      clip: linked('clip'),
      levels: [{ ...original.levels[0]!, mask: linked('level') }],
      strokes: [
        {
          schemaVersion: 1 as const,
          id: 'stroke',
          componentId: 'source-1',
          mode: 'flatten' as const,
          points: [],
          diameterMm: 1,
          strength: 1,
          flattenHeightMm: 1,
          region: linked('sculpt'),
        },
      ],
      components: [
        ...original.components,
        {
          ...original.components[1]!,
          id: 'rail',
          mask: linked('component'),
          source: {
            kind: 'rail-profile-v1' as const,
            rail: { points: [], linkedObjectId: 'first' },
            secondRail: { points: [], linkedObjectId: 'second' },
            widthMm: 1,
            samplingSteps: 1,
            sections: [],
          },
        },
      ],
    };
    expect(reliefAuthoringLinkIds(document)).toEqual([
      'boundary',
      'clip',
      'component',
      'first',
      'level',
      'mask',
      'sculpt',
      'second',
    ]);
  });
});
function statuses(current: Project, previous: Project) {
  return cncDependencyStatuses(cncPreparationInputs(current), cncPreparationInputs(previous));
}
function editedSource(project: Project, source: SceneObject): Project {
  return projectWithRefreshedReliefLinks({
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => (object.id === source.id ? source : object)),
    },
  });
}
