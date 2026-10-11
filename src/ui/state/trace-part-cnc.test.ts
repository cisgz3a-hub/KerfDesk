import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testAuthoringRelief, testMaterializedRelief } from '../../__fixtures__/relief-authoring';
import { cncSideInputScene } from '../../core/cnc/cnc-two-sided-setup';
import {
  createReliefAuthoringDocument,
  reviseReliefDocument,
} from '../../core/relief/relief-authoring-document';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type Scene,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { load, square, trace } from './trace-part.test-support';

beforeEach(resetStore);
afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

function twoSided(sideAObjectIds: readonly string[], sideBObjectIds: readonly string[]): void {
  load(trace());
  useStore.setState((state) => ({
    project: {
      ...state.project,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        twoSided: {
          activeSide: 'A',
          sideAObjectIds,
          sideBObjectIds,
          flipAxis: 'y',
          sideBStockOriginMm: { x: 4, y: 7 },
          registration: [{ id: 'pin', name: 'Pin', stockXMm: 2, stockYMm: 3, diameterMm: 4 }],
        },
      },
    },
  }));
}

function contours(scene: Scene): unknown[] {
  return scene.objects.flatMap((object) =>
    'paths' in object ? object.paths.flatMap((path) => path.polylines) : [],
  );
}

function sideScene(project: Project, activeSide: 'A' | 'B'): Scene {
  const setup = project.cncSetup!;
  return cncSideInputScene(
    { ...project, cncSetup: { ...setup, twoSided: { ...setup.twoSided!, activeSide } } },
    project.scene,
  );
}

describe('trace part two-sided CNC membership', () => {
  it.each([
    { name: 'side A', a: ['trace'], b: [] },
    { name: 'side B', a: [], b: ['trace'] },
    { name: 'both sides', a: ['trace'], b: ['trace'] },
  ])('keeps all original contours assigned to $name with one exact undo step', ({ a, b }) => {
    twoSided(a, b);
    const before = useStore.getState().project;
    const id = useStore.getState().detachTracePart('trace', 0, 2);
    expect(id).toBe('trace__part_1');
    const after = useStore.getState().project;
    for (const side of ['A', 'B'] as const) {
      expect(contours(sideScene(after, side))).toEqual(contours(sideScene(before, side)));
    }
    expect(after.cncSetup?.twoSided).toEqual({
      ...before.cncSetup?.twoSided,
      sideAObjectIds: a.length ? ['trace', id] : [],
      sideBObjectIds: b.length ? ['trace', id] : [],
    });
    const opened = deserializeProject(serializeProject(after));
    expect(opened.kind).toBe('ok');
    if (opened.kind === 'ok') expect(opened.project.cncSetup).toEqual(after.cncSetup);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
  });

  it('restores both side assignments when a detach-and-drag interaction is cancelled', () => {
    twoSided(['trace'], ['trace']);
    const before = useStore.getState().project;
    useStore.getState().beginInteraction();
    const id = useStore.getState().detachTracePart('trace', 0, 2)!;
    expect(useStore.getState().project.cncSetup?.twoSided?.sideBObjectIds).toContain(id);
    useStore.getState().cancelInteraction();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('does not assign artwork that was outside both sides or rewrite an unrelated setup', () => {
    twoSided([], []);
    const setup = useStore.getState().project.cncSetup;
    expect(useStore.getState().detachTracePart('trace', 0, 2)).toBe('trace__part_1');
    expect(useStore.getState().project.cncSetup).toBe(setup);
  });
});

const LINK_KINDS = ['clip', 'level', 'component', 'boundary', 'stroke'] as const;
type LinkKind = (typeof LINK_KINDS)[number];
const RINGS = [square(0, 2), square(4, 2)];

function linkedDocument(kind: LinkKind): ReliefAuthoringDocument {
  const document = createReliefAuthoringDocument(testAuthoringRelief().reliefSource);
  const mask = { rings: RINGS, linkedObjectId: 'trace' };
  const component = document.components[0]!;
  switch (kind) {
    case 'clip':
      return { ...document, clip: mask };
    case 'level':
      return { ...document, levels: [{ ...document.levels[0]!, mask }] };
    case 'component':
      return { ...document, components: [{ ...component, mask }] };
    case 'boundary':
      return {
        ...document,
        components: [
          {
            ...component,
            source: {
              kind: 'vector-shape-v1',
              boundary: mask,
              profile: 'plane',
              heightMm: 3,
              angleDeg: 0,
            },
          },
        ],
      };
    case 'stroke':
      return {
        ...document,
        strokes: [
          {
            schemaVersion: 1,
            id: 'sculpt',
            componentId: component.id,
            mode: 'flatten',
            points: [{ x: 5, y: 5 }],
            diameterMm: 2,
            strength: 1,
            flattenHeightMm: 3,
            region: mask,
          },
        ],
      };
  }
}

function installRelief(document: ReliefAuthoringDocument, locked = false): HeightfieldReliefObject {
  const relief = {
    ...testAuthoringRelief(),
    reliefAuthoring: document,
    reliefSource: testMaterializedRelief(document),
    locked,
    operationIds: [],
  };
  load({
    ...trace([{ color: '#000000', operationIds: ['cut'], polylines: RINGS }]),
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 6, maxY: 6 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { ...state.project.scene, objects: [...state.project.scene.objects, relief] },
    },
  }));
  return relief;
}

describe('trace part retained relief dependencies', () => {
  it.each(LINK_KINDS)(
    'preserves a live relief %s without rematerializing or adding undo',
    (kind) => {
      const relief = installRelief(linkedDocument(kind), true);
      const before = useStore.getState();
      const id = useStore.getState().detachTracePart('trace', 0, 1);
      expect(
        useStore.getState().project.scene.objects.find((object) => object.id === relief.id),
      ).toBe(relief);
      expect(id).toBeNull();
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().dirty).toBe(false);
      expect(useToastStore.getState().toasts.at(-1)?.message).toContain('relief');
    },
  );

  it('allows separating parts after Composition clip is explicitly cleared in the relief editor', () => {
    const relief = installRelief(linkedDocument('clip'));
    expect(useStore.getState().detachTracePart('trace', 0, 1)).toBeNull();
    const { clip: _clip, ...withoutClip } = relief.reliefAuthoring!;
    const document = reviseReliefDocument(withoutClip, {});
    expect(
      useStore
        .getState()
        .commitReliefAuthoring(
          relief.id,
          relief.reliefAuthoring!.revision,
          document,
          testMaterializedRelief(document),
          { source: relief.reliefSource, documentEpoch: 0 },
        ),
    ).toBe(true);
    expect(useStore.getState().detachTracePart('trace', 0, 1)).toBe('trace__part_1');
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it.each(['rail', 'secondRail'] as const)(
    'keeps a retained %s link explicit when its source was previously edited into multiple paths',
    (key) => {
      const document = createReliefAuthoringDocument(testAuthoringRelief().reliefSource);
      const source = {
        kind: 'rail-profile-v1' as const,
        rail: {
          points: [
            { x: 1, y: 1 },
            { x: 1, y: 5 },
          ],
          ...(key === 'rail' ? { linkedObjectId: 'trace' } : {}),
        },
        secondRail: {
          points: [
            { x: 5, y: 1 },
            { x: 5, y: 5 },
          ],
          ...(key === 'secondRail' ? { linkedObjectId: 'trace' } : {}),
        },
        widthMm: 4,
        samplingSteps: 2,
        sections: [0, 1].map((position) => ({
          id: `section-${position}`,
          position,
          widthScale: 1,
          profile: [
            { x: 0, y: 3 },
            { x: 1, y: 3 },
          ],
        })),
      };
      const relief = installRelief({
        ...document,
        components: [{ ...document.components[0]!, source }],
      });
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) =>
              object.id === 'trace'
                ? {
                    ...trace([
                      {
                        color: '#000000',
                        operationIds: ['cut'],
                        polylines: [
                          { closed: false, points: source[key].points },
                          {
                            closed: false,
                            points: [
                              { x: 2, y: 0 },
                              { x: 2, y: 6 },
                            ],
                          },
                        ],
                      },
                    ]),
                    traceMode: 'centerline' as const,
                    transform: IDENTITY_TRANSFORM,
                  }
                : object,
            ),
          },
        },
      }));
      const before = useStore.getState().project;
      expect(useStore.getState().detachTracePart('trace', 0, 1)).toBeNull();
      expect(useStore.getState().project).toBe(before);
      expect(useStore.getState().project.scene.objects).toContain(relief);
      expect(useStore.getState().undoStack).toHaveLength(0);
    },
  );
});
