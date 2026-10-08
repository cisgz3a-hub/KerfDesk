import { registrationBoxBounds } from '../../io/gcode/prepare-output';
import { createRegistrationBox } from '../../core/shapes';
import {
  createRegistrationLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore, currentOutputScope } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { emitGcode } from '../../io/gcode';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { reliefProjectionProject } from '../../__fixtures__/relief-projection';

beforeEach(installFrameOnceProject);
afterEach(() => useLaserStore.setState(initialLaserState()));

function installSelectedArtwork() {
  const original = useStore.getState().project;
  const selected = original.scene.objects[0]!;
  const unused = { ...selected, id: 'unused', transform: { ...selected.transform, x: 30 } };
  useStore.setState({
    project: { ...original, scene: { ...original.scene, objects: [selected, unused] } },
    outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    selectedObjectId: selected.id,
    additionalSelectedIds: new Set(),
  });
  return { selected, unused };
}

function moveObject(id: string, x: number): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          object.id === id ? { ...object, transform: { ...object.transform, x } } : object,
        ),
      },
    },
  }));
}

function currentProgram(): string {
  const app = useStore.getState();
  return emitGcode(app.project, {
    outputScope: currentOutputScope(app),
    jobOrigin:
      app.jobPlacement.startFrom === 'current-position'
        ? { ...app.jobPlacement, startFrom: 'current-position', currentPosition: { x: 0, y: 0 } }
        : { ...app.jobPlacement, startFrom: app.jobPlacement.startFrom },
  }).gcode;
}

describe('selected-only Frame coordinate ownership', () => {
  it('retains the completed Frame after an unrelated absolute-output edit while execution review changes', async () => {
    const { unused } = installSelectedArtwork();
    const program = currentProgram();
    expect(program).toContain('G1');
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    ensureFramedRunInvalidationSubscriptions();
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    moveObject(unused.id, 60);
    expect(currentProgram()).toBe(program);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
    expect(currentFrameSpatialSignature()).toBe(spatial);
    expect(useLaserStore.getState().framedRun).toBe(permit);
  });

  it('retains an unrelated edit when relative placement anchors to the selected artwork', () => {
    const { unused } = installSelectedArtwork();
    useStore.setState({
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: true },
      jobPlacement: { startFrom: 'user-origin', anchor: 'back-right' },
    });
    const program = currentProgram();
    const spatial = currentFrameSpatialSignature();
    moveObject(unused.id, 60);
    expect(currentProgram()).toBe(program);
    expect(currentFrameSpatialSignature()).toBe(spatial);
  });

  it('invalidates an unselected edit that moves the full-scene relative anchor', () => {
    const { unused } = installSelectedArtwork();
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'back-right' } });
    const program = currentProgram();
    const spatial = currentFrameSpatialSignature();
    moveObject(unused.id, 60);
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });

  it('invalidates selected coordinates even when the bounding rectangle is unchanged', () => {
    const { selected } = installSelectedArtwork();
    const spatial = currentFrameSpatialSignature();
    const program = currentProgram();
    if (selected.kind !== 'imported-svg') throw new Error('Expected imported geometry');
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === selected.id
              ? {
                  ...selected,
                  paths: selected.paths.map((path) => ({
                    ...path,
                    polylines: path.polylines.map((polyline) => ({
                      ...polyline,
                      points: [polyline.points[0]!, { x: 5, y: 4 }, ...polyline.points.slice(1)],
                    })),
                  })),
                }
              : object,
          ),
        },
      },
    }));
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });

  it('retains unrelated edits when a disabled registration jig owns the relative anchor', () => {
    const { unused } = installSelectedArtwork();
    const jig = createRegistrationBox({ id: 'jig', widthMm: 80, heightMm: 40, x: 10, y: 20 });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [...state.project.scene.objects, jig],
          layers: [...state.project.scene.layers, { ...createRegistrationLayer(), output: false }],
        },
      },
      jobPlacement: { startFrom: 'user-origin', anchor: 'back-right' },
    }));
    const program = currentProgram();
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    moveObject(unused.id, 60);
    expect(currentProgram()).toBe(program);
    expect(currentFrameSpatialSignature()).toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
    moveObject(jig.id, 20);
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });

  it('keeps the full-scene anchor when a CNC registration jig belongs only to the inactive side', () => {
    const { selected, unused } = installSelectedArtwork();
    const jig = createRegistrationBox({
      id: 'inactive-jig',
      widthMm: 80,
      heightMm: 40,
      x: 10,
      y: 20,
    });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        cncSetup: {
          ...defaultCncMachiningSetup(),
          twoSided: {
            activeSide: 'A',
            flipAxis: 'x',
            sideBStockOriginMm: { x: 0, y: 0 },
            sideAObjectIds: [selected.id, unused.id],
            sideBObjectIds: [jig.id],
            registration: [],
          },
        },
        scene: {
          ...state.project.scene,
          objects: [...state.project.scene.objects, jig],
          layers: [
            ...state.project.scene.layers.map((layer) => ({
              ...layer,
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                cutType: 'profile-on-path' as const,
                depthMm: 1,
              },
            })),
            { ...createRegistrationLayer(), output: false },
          ],
        },
      },
      jobPlacement: { startFrom: 'user-origin', anchor: 'back-right' },
    }));
    const program = currentProgram();
    const spatial = currentFrameSpatialSignature();
    expect(program).toContain('G1');
    moveObject(unused.id, 60);
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });

  it('keeps full-scene dependencies when an inside-profile CNC jig compiles to no anchor', () => {
    const { unused } = installSelectedArtwork();
    const jig = createRegistrationBox({
      id: 'collapsed-jig',
      widthMm: 1,
      heightMm: 1,
      x: 10,
      y: 20,
    });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: {
          ...state.project.scene,
          objects: [...state.project.scene.objects, jig],
          layers: [
            ...state.project.scene.layers.map((layer) => ({
              ...layer,
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                cutType: 'profile-on-path' as const,
                depthMm: 1,
              },
            })),
            {
              ...createRegistrationLayer(),
              output: false,
              cnc: {
                ...DEFAULT_CNC_LAYER_SETTINGS,
                cutType: 'profile-inside' as const,
                depthMm: 1,
              },
            },
          ],
        },
      },
      jobPlacement: { startFrom: 'user-origin', anchor: 'back-right' },
    }));
    expect(registrationBoxBounds(useStore.getState().project)).toBeNull();
    const program = currentProgram();
    const spatial = currentFrameSpatialSignature();
    expect(program).toContain('G1');
    moveObject(unused.id, 60);
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });

  it('retains unselected live authoring sources needed by a selected projection', () => {
    useStore.setState({
      project: reliefProjectionProject(),
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
      selectedObjectId: 'vector',
      additionalSelectedIds: new Set(),
    });
    const spatial = currentFrameSpatialSignature();
    const program = currentProgram();
    moveObject('boundary', 0);
    expect(currentProgram()).not.toBe(program);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });
});
