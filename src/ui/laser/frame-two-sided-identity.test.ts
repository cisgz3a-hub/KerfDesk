import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { DEFAULT_CNC_WRAP_STUDY } from '../../core/scene/cnc-wrap-study';
import { reliefProjectionProject } from '../../__fixtures__/relief-projection';
import type { Project } from '../../core/scene/project';
import type { CncTwoSidedSetup } from '../../core/scene/cnc-two-sided-setup';
import type { SceneObject } from '../../core/scene/scene-object';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene/machine';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
beforeEach(installFrameOnceProject);
afterEach(() => useLaserStore.setState(initialLaserState()));
describe('two-sided Frame spatial retention', () => {
  it('invalidates side and datum transforms while ignoring setup warning and reference-study metadata', () => {
    const initial = useStore.getState().project,
      setup = {
        ...defaultCncMachiningSetup(),
        twoSided: {
          activeSide: 'A' as const,
          flipAxis: 'y' as const,
          sideBStockOriginMm: { x: 0, y: 0 },
          sideAObjectIds: initial.scene.objects.map((o) => o.id),
          sideBObjectIds: initial.scene.objects.map((o) => o.id),
          registration: [],
        },
      };
    useStore.setState({
      project: { ...initial, machine: DEFAULT_CNC_MACHINE_CONFIG, cncSetup: setup },
    });
    const signature = currentFrameSpatialSignature(),
      project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        cncSetup: {
          ...setup,
          name: 'Renamed',
          notes: 'Fixture check',
          wrapStudy: DEFAULT_CNC_WRAP_STUDY,
          fixtures: [
            {
              id: 'clamp',
              name: 'Clamp',
              xMm: 2,
              yMm: 2,
              widthMm: 5,
              heightMm: 5,
              bottomZMm: 0,
              topZMm: 20,
            },
          ],
        },
      },
    });
    expect(currentFrameSpatialSignature()).toBe(signature);
    useStore.setState({
      project: {
        ...project,
        cncSetup: { ...setup, twoSided: { ...setup.twoSided, activeSide: 'B' } },
      },
    });
    expect(currentFrameSpatialSignature()).not.toBe(signature);
    const sideB = currentFrameSpatialSignature();
    useStore.setState({
      project: {
        ...project,
        cncSetup: {
          ...setup,
          twoSided: { ...setup.twoSided, activeSide: 'B', sideBStockOriginMm: { x: 4, y: 7 } },
        },
      },
    });
    expect(currentFrameSpatialSignature()).not.toBe(sideB);
  });
});

function installSideProject(activeSide: 'A' | 'B' = 'A'): Project {
  const original = useStore.getState().project;
  const a = original.scene.objects[0];
  if (a === undefined) throw new Error('Missing active artwork');
  const b: SceneObject = { ...a, id: 'side-b', transform: { ...a.transform, x: 20 } };
  const project: Project = {
    ...original,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    cncSetup: {
      ...defaultCncMachiningSetup(),
      twoSided: {
        activeSide,
        flipAxis: 'y',
        sideBStockOriginMm: { x: 4, y: 7 },
        sideAObjectIds: [a.id],
        sideBObjectIds: [b.id],
        registration: [],
      },
    },
    scene: {
      ...original.scene,
      objects: [a, b],
      layers: original.scene.layers.map((layer) => ({
        ...layer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'profile-on-path', depthMm: 1 },
      })),
    },
  };
  useStore.setState({ project });
  return project;
}
function patchSide(project: Project, patch: Partial<CncTwoSidedSetup>): Project {
  const setup = project.cncSetup;
  if (setup?.twoSided === undefined) throw new Error('Missing two-sided fixture');
  return { ...project, cncSetup: { ...setup, twoSided: { ...setup.twoSided, ...patch } } };
}
function moveArtwork(project: Project, id: string, x: number): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        object.id === id ? { ...object, transform: { ...object.transform, x } } : object,
      ),
    },
  };
}
function output(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return { job: prepared.job, gcode: emitGcode(project).gcode };
}
function expectInactiveEdit(project: Project, edited: Project, byteIdentical = true): void {
  const before = currentFrameSpatialSignature();
  const exact = currentReplayExecutionSignature();
  const originalOutput = output(project);
  useStore.setState({ project: edited });
  expect(output(edited).job).toEqual(originalOutput.job);
  if (byteIdentical) expect(output(edited).gcode).toBe(originalOutput.gcode);
  expect(currentFrameSpatialSignature()).toBe(before);
  expect(currentReplayExecutionSignature()).not.toBe(exact);
}

describe('active-side Frame identity with off-output geometry dependencies', () => {
  it('retains completed A Frame for future B edits, then clears it when B becomes active', async () => {
    const project = installSideProject();
    ensureFramedRunInvalidationSubscriptions();
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    const edited = moveArtwork(
      patchSide(project, {
        sideBStockOriginMm: { x: 40, y: 70 },
        sideBObjectIds: [],
        flipAxis: 'x',
      }),
      'side-b',
      80,
    );
    expectInactiveEdit(project, edited, false);
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    expect(framedRunReadinessIssue(framed)).toBeNull();
    useStore.setState({
      project: patchSide(edited, { activeSide: 'B', sideBObjectIds: ['side-b'] }),
    });
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it.each([
    ['future B datum', { sideBStockOriginMm: { x: 40, y: 70 } }],
    ['future B artwork selection', { sideBObjectIds: [] }],
    ['future B flip axis', { flipAxis: 'x' as const }],
  ] as const)('ignores %s while A is active and retains exact review identity', (_label, patch) => {
    const project = installSideProject();
    expectInactiveEdit(project, patchSide(project, patch), _label !== 'future B flip axis');
  });
  it('ignores B-only artwork geometry while A output excludes it', () => {
    const project = installSideProject();
    expectInactiveEdit(project, moveArtwork(project, 'side-b', 80));
  });
  it('ignores A-only selection and geometry while B output excludes them', () => {
    const project = installSideProject('B');
    expectInactiveEdit(
      project,
      moveArtwork(patchSide(project, { sideAObjectIds: [] }), 'line-object', 80),
    );
  });
  it.each([
    ['B datum', { sideBStockOriginMm: { x: 40, y: 70 } }],
    ['B flip axis', { flipAxis: 'x' as const }],
    ['active B artwork selection', { sideBObjectIds: ['line-object'] }],
  ] as const)('still invalidates active %s coordinates', (_label, patch) => {
    const project = installSideProject('B');
    const before = currentFrameSpatialSignature();
    const original = output(project);
    const edited = patchSide(project, patch);
    useStore.setState({ project: edited });
    expect(output(edited).gcode).not.toBe(original.gcode);
    expect(currentFrameSpatialSignature()).not.toBe(before);
  });
  it.each(['A', 'B'] as const)('still invalidates %s active artwork geometry', (side) => {
    const project = installSideProject(side);
    const before = currentFrameSpatialSignature();
    const edited = moveArtwork(project, side === 'A' ? 'line-object' : 'side-b', 50);
    useStore.setState({ project: edited });
    expect(output(edited).gcode).not.toBe(output(project).gcode);
    expect(currentFrameSpatialSignature()).not.toBe(before);
  });
  it('keeps an off-output projection target and its live boundary/mask sources spatially authoritative', () => {
    const original = reliefProjectionProject();
    const project: Project = {
      ...original,
      cncSetup: {
        ...defaultCncMachiningSetup(),
        twoSided: {
          activeSide: 'A',
          flipAxis: 'y',
          sideBStockOriginMm: { x: 4, y: 7 },
          sideAObjectIds: ['vector'],
          sideBObjectIds: ['relief', 'boundary', 'mask'],
          registration: [],
        },
      },
    };
    useStore.setState({ project });
    const before = currentFrameSpatialSignature();
    const emitted = output(project).gcode;
    const changed = moveArtwork(project, 'boundary', 0);
    useStore.setState({ project: changed });
    expect(output(changed).gcode).not.toBe(emitted);
    expect(currentFrameSpatialSignature()).not.toBe(before);
    for (const id of ['relief', 'mask']) {
      useStore.setState({ project });
      const spatial = currentFrameSpatialSignature();
      useStore.setState({ project: moveArtwork(project, id, 1) });
      expect(currentFrameSpatialSignature()).not.toBe(spatial);
    }
  });
});
