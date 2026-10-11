import { afterEach, beforeEach, expect, it } from 'vitest';
import { testAuthoringRelief } from '../../__fixtures__/relief-authoring';
import { createReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { findRegistrationBoxes } from '../../core/scene';
import { registrationJigCopyId } from '../../core/scene/registration-jig-artwork';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { actions, load, trace } from './trace-part.test-support';

beforeEach(resetStore);
afterEach(() => {
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
});

const LINK_KINDS = [
  'clip',
  'level',
  'component',
  'boundary',
  'stroke',
  'rail',
  'secondRail',
] as const;
type LinkKind = (typeof LINK_KINDS)[number];

function documentWithLink(kind: LinkKind, id: string): ReliefAuthoringDocument {
  const document = createReliefAuthoringDocument(testAuthoringRelief().reliefSource);
  const component = document.components[0]!;
  const mask = { rings: [trace().paths[0]!.polylines[2]!], linkedObjectId: id };
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
            id: 'stroke',
            componentId: component.id,
            mode: 'flatten',
            points: [{ x: 1, y: 1 }],
            diameterMm: 1,
            strength: 1,
            flattenHeightMm: 1,
            region: mask,
          },
        ],
      };
    case 'rail':
    case 'secondRail':
      return {
        ...document,
        components: [
          {
            ...component,
            source: {
              kind: 'rail-profile-v1',
              rail: {
                points: [
                  { x: 0, y: 0 },
                  { x: 0, y: 5 },
                ],
                ...(kind === 'rail' ? { linkedObjectId: id } : {}),
              },
              secondRail: {
                points: [
                  { x: 5, y: 0 },
                  { x: 5, y: 5 },
                ],
                ...(kind === 'secondRail' ? { linkedObjectId: id } : {}),
              },
              widthMm: 5,
              samplingSteps: 2,
              sections: [0, 1].map((position) => ({
                id: `section-${position}`,
                position,
                widthScale: 1,
                profile: [
                  { x: 0, y: 1 },
                  { x: 1, y: 1 },
                ],
              })),
            },
          },
        ],
      };
  }
}

function installJig(): { copyId: string; partId: string } {
  load(trace());
  useStore.getState().replaceRegistrationJigSet({
    outline: { kind: 'rectangle', widthMm: 50, heightMm: 40 },
    rows: 1,
    columns: 2,
    spacingX: 10,
    spacingY: 0,
  });
  useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set() });
  useStore.getState().centerSelectionInRegistrationBox();
  const secondBox = findRegistrationBoxes(useStore.getState().project.scene)[1]!;
  const copyId = registrationJigCopyId('trace', secondBox.id);
  const partId = actions.detachTracePart(copyId, 0, 2);
  if (partId === null) throw new Error('part was not detached');
  return { copyId, partId };
}

it.each(LINK_KINDS)(
  'does not replace a detached jig descendant retained as a relief %s',
  (kind) => {
    const { copyId, partId } = installJig();
    useStore.getState().removeSceneObject(copyId);
    const relief = {
      ...testAuthoringRelief(),
      locked: true,
      visible: false,
      reliefAuthoring: documentWithLink(kind, partId),
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: { ...state.project.scene, objects: [...state.project.scene.objects, relief] },
      },
      selectedObjectId: 'trace',
      additionalSelectedIds: new Set(),
      dirty: false,
    }));
    const before = useStore.getState();
    useStore.getState().centerSelectionInRegistrationBox();
    const after = useStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.redoStack).toBe(before.redoStack);
    expect(after.selectedObjectId).toBe('trace');
    expect(after.dirty).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('relief');
  },
);

it('allows replacement after the retained relief link is explicitly removed', () => {
  const { partId } = installJig();
  const relief = {
    ...testAuthoringRelief(),
    reliefAuthoring: createReliefAuthoringDocument(testAuthoringRelief().reliefSource),
  };
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: [...state.project.scene.objects, relief] },
    },
    selectedObjectId: 'trace',
    additionalSelectedIds: new Set(),
  }));
  const before = useStore.getState().project;
  useStore.getState().centerSelectionInRegistrationBox();
  expect(useStore.getState().project.scene.objects.some((object) => object.id === partId)).toBe(
    false,
  );
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(before);
});
