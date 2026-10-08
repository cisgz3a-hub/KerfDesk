/* eslint-disable no-restricted-syntax -- Hex values are artwork colours, not UI styling. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JOB_ORIGIN_ANCHORS, machineSpaceJob, type JobOriginPlacement } from '../../core/job';
import { computeFrameJobBounds } from '../../core/job/job-bounds';
import type { Origin } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  createRegistrationLayer,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { currentOutputScope, useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';

beforeEach(installFrameOnceProject);
afterEach(() => useLaserStore.setState(initialLaserState()));

function vector(id: string, x: number): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: 'anchor.svg',
    transform: { ...IDENTITY_TRANSFORM, x },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function installArtwork(origin: Origin = 'front-left'): void {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      device: { ...base.device, origin },
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...base.scene,
        objects: [vector('selected', 0), vector('interior-unused', 30), vector('far-anchor', 100)],
        layers: [
          {
            ...createLayer({ id: 'vectors', color: '#000000' }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'profile-on-path',
              depthMm: 1,
            },
          },
        ],
      },
    },
    outputScopeSettings: { cutSelectedGraphics: false, useSelectionOrigin: false },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
  useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
  useStore.getState().selectObject('selected');
  useStore.getState().setJobPlacement({ startFrom: 'user-origin', anchor: 'back-right' });
  expect(deserializeProject(serializeProject(useStore.getState().project)).kind).toBe('ok');
}

function moveObject(id: string, x: number): void {
  const object = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (object === undefined) throw new Error('Missing anchor fixture');
  useStore.getState().applyObjectTransform(id, { ...object.transform, x });
}

function snapshot() {
  const app = useStore.getState();
  const placement = app.jobPlacement;
  const jobOrigin: JobOriginPlacement =
    placement.startFrom === 'current-position'
      ? { ...placement, startFrom: 'current-position', currentPosition: { x: 14, y: 17 } }
      : { ...placement, startFrom: placement.startFrom };
  const options = { outputScope: currentOutputScope(app), jobOrigin };
  const prepared = prepareOutput(app.project, options);
  if (!prepared.ok) throw new Error('Expected admitted selected CNC output');
  return {
    program: emitGcode(app.project, options).gcode,
    offset: prepared.jobOriginOffset,
    bounds: computeFrameJobBounds(
      machineSpaceJob(prepared.job, prepared.project.device, prepared.project.machine),
      prepared.project.device,
    ),
    signature: currentFrameSpatialSignature(app),
  };
}

describe('selected output binds the actual whole-scene placement anchor', () => {
  it('retains completed Frame through an admitted unused interior edit with identical fresh output', async () => {
    installArtwork();
    const before = snapshot();
    const execution = currentReplayExecutionSignature();
    expect(before.program).toContain('G1');
    ensureFramedRunInvalidationSubscriptions();
    useLaserStore.setState({ workOriginActive: true });
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    moveObject('interior-unused', 40);
    expect(snapshot()).toEqual(before);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
    expect(useLaserStore.getState().framedRun).toBe(permit);
    moveObject('far-anchor', 150);
    const afterAnchor = snapshot();
    expect(afterAnchor.offset).not.toEqual(before.offset);
    expect(afterAnchor.bounds).not.toEqual(before.bounds);
    expect(afterAnchor.program).not.toBe(before.program);
    expect(afterAnchor.signature).not.toBe(before.signature);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it.each([false, true])(
    'ignores an interior unused registration fixture when selection origin is %s',
    (useSelectionOrigin) => {
      installArtwork();
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: [
              ...state.project.scene.objects,
              createRegistrationBox({ id: 'outer-jig', x: 10, y: 20, widthMm: 80, heightMm: 40 }),
              createRegistrationBox({ id: 'inner-jig', x: 30, y: 30, widthMm: 8, heightMm: 4 }),
            ],
            layers: [
              ...state.project.scene.layers,
              { ...createRegistrationLayer(), output: false },
            ],
          },
        },
      }));
      useStore.getState().setOutputScopeSettings({ useSelectionOrigin });
      const before = snapshot();
      moveObject('inner-jig', 40);
      expect(snapshot()).toEqual(before);
      moveObject('outer-jig', 20);
      expect(snapshot().offset).not.toEqual(before.offset);
      expect(snapshot().signature).not.toBe(before.signature);
    },
  );

  const origins: ReadonlyArray<Origin> = [
    'front-left',
    'front-right',
    'rear-left',
    'rear-right',
    'center',
  ];
  const cases = origins.flatMap((origin) =>
    JOB_ORIGIN_ANCHORS.map((anchor) => ({ origin, anchor })),
  );
  it.each(cases)('matches actual anchor ownership for $origin / $anchor', ({ origin, anchor }) => {
    installArtwork(origin);
    useStore.getState().setJobPlacement({ anchor });
    const before = snapshot();
    moveObject('interior-unused', 40);
    expect(snapshot()).toEqual(before);
    moveObject('far-anchor', 150);
    const after = snapshot();
    const changed = after.offset.x !== before.offset.x || after.offset.y !== before.offset.y;
    expect(after.signature === before.signature).toBe(!changed);
    expect(after.program === before.program).toBe(!changed);
    expect(after.bounds === null).toBe(false);
  });

  it.each(['current-position', 'verified-origin'] as const)(
    'retains interior edits for %s placement',
    (startFrom) => {
      installArtwork();
      useStore.getState().setJobPlacement({ startFrom });
      const before = snapshot();
      moveObject('interior-unused', 40);
      expect(snapshot()).toEqual(before);
      moveObject('far-anchor', 150);
      expect(snapshot().signature).not.toBe(before.signature);
    },
  );

  it.each(['A', 'B'] as const)(
    'uses the transformed active side %s for the actual placement anchor',
    (activeSide) => {
      installArtwork();
      const ids = ['selected', 'interior-unused', 'far-anchor'];
      useStore.setState((state) => ({
        project: {
          ...state.project,
          cncSetup: {
            ...defaultCncMachiningSetup(),
            twoSided: {
              activeSide,
              flipAxis: 'x',
              sideBStockOriginMm: { x: 27, y: 19 },
              sideAObjectIds: ids,
              sideBObjectIds: ids,
              registration: [],
            },
          },
        },
      }));
      const before = snapshot();
      moveObject('interior-unused', 40);
      expect(snapshot()).toEqual(before);
      moveObject('far-anchor', 150);
      expect(snapshot().signature).not.toBe(before.signature);
    },
  );
});
