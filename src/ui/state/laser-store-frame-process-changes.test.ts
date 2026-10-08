import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type LayerOperationSettings,
} from '../../core/scene';
import {
  boxes,
  burns,
  burnLength,
  contourOrder,
  expectFill,
  ownedLength,
  ownerOf,
  type Owner,
  type Box,
} from '../../__fixtures__/frame-process-output';
import { frameOnceRepository, installFrameOnceProject } from '../laser/frame-once.test-support';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { preparedMatchesCompletedFrame } from '../laser/framed-start-preparation';
import { captureJobReviewModels, installAutoJobReview } from '../laser/job-review/testing';
import { useJobReviewStore } from '../laser/job-review';
import { prepareCurrentStartJob } from '../laser/start-job-source';
import { runStartJobFlow } from '../laser/start-job-flow';
import { useCameraStore } from './camera-store';
import { consumeClaimedFramedRun } from './framed-run-start-consumption';
import type { FramedRunPermit } from './framed-run';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { useStore } from './store';
import { useToastStore } from './toast-store';

vi.mock('./job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
let uninstallReview: () => void = () => undefined;
let reviews: ReturnType<typeof captureJobReviewModels>;

beforeEach(() => {
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useJobReviewStore.getState().close();
  useToastStore.setState({ toasts: [] });
  // Existing ADR-565 boundary: real preparation/review/claim/archive, with the
  // wire handoff consumed explicitly. This fixture does not execute hardware.
  useLaserStore.setState({
    startJob: vi.fn(async (_gcode, options = {}) => {
      options.assertFinalStartAuthorized?.();
      consumeClaimedFramedRun(
        useLaserStore.setState,
        useLaserStore.getState,
        options.framedRunPermit,
      );
    }),
  });
  reviews = captureJobReviewModels();
  uninstallReview = installAutoJobReview('confirm');
});
afterEach(() => {
  uninstallReview();
  reviews.stop();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

function installNested(
  mode: 'fill' | 'line' | 'mixed',
  linePatch: Partial<LayerOperationSettings> = {},
) {
  const operationIds = mode === 'mixed' ? ['fill', 'line'] : [mode];
  const objects: ImportedSvg[] = (Object.entries(boxes) as [Owner, Box][]).map(([id, bounds]) => ({
    id,
    kind: 'imported-svg',
    source: id + '.svg',
    bounds,
    transform: IDENTITY_TRANSFORM,
    operationIds,
    paths: [
      {
        color: '#000000',
        fillRule: 'evenodd',
        polylines: [
          {
            closed: true,
            points: [
              { x: bounds.minX, y: bounds.minY },
              { x: bounds.maxX, y: bounds.minY },
              { x: bounds.maxX, y: bounds.maxY },
              { x: bounds.minX, y: bounds.maxY },
            ],
          },
        ],
      },
    ],
  }));
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: {
        ...state.project.device,
        origin: 'rear-left',
        bedWidth: 120,
        bedHeight: 120,
        scanningOffsets: [],
      },
      optimization: {
        ...state.project.optimization,
        pathDirection: 'preserve',
        closedShapeStart: 'drawn',
      },
      scene: {
        ...state.project.scene,
        objects,
        layers: operationIds.map((id) => ({
          ...createLayer({ id, color: '#000000', mode: id === 'fill' ? 'fill' : 'line' }),
          power: mode === 'mixed' && id === 'line' ? 55 : 80,
          speed: 1200,
          passes: 1,
          hatchSpacingMm: 4,
          hatchAngleDeg: 0,
          fillOverscanMm: 0,
          fillBidirectional: false,
          autoOverscan: false,
          fillCrossHatch: false,
          passAngleStepDeg: 0,
          airAssist: false,
          ...(id === 'line' ? linePatch : {}),
        })),
      },
    },
  }));
}

function process(
  owner: Owner,
  operation: 'fill' | 'line',
  power: number,
  speed = 1200,
  passes = 1,
) {
  useStore
    .getState()
    .setObjectsOperationOverrideForOperation([owner], operation, { power, speed, passes });
}

async function startFresh(frame: FramedRunPermit) {
  expect(useLaserStore.getState().completedFrame).not.toBeNull();
  const fresh = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
    frame.candidate.preparedStart.jobOrigin,
    false,
  );
  if (!fresh.ok) throw new Error(fresh.messages.join(' '));
  // The test's process edits have no runway/scan-calibration change. Qualify
  // the actual motion envelope, rather than assuming every speed edit is neutral.
  expect(preparedMatchesCompletedFrame(frame, fresh)).toBe(true);
  const before = vi.mocked(useLaserStore.getState().startJob).mock.calls.length;
  const repository = frameOnceRepository();
  await runStartJobFlow(repository);
  const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
  expect(calls).toHaveLength(before + 1);
  const gcode = calls[before]?.[0];
  expect(gcode).toBe(fresh.gcode);
  expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
  expect(useLaserStore.getState().framedRun).toBeNull();
  expect(useLaserStore.getState().completedFrame?.candidate.frameVerification.boundsSignature).toBe(
    frame.candidate.frameVerification.boundsSignature,
  );
  if (gcode === undefined) throw new Error('Expected newly reviewed output.');
  return { gcode, job: fresh.prepared.job };
}

describe('ADR-565 process buckets retain Frame and Start reviews current topology/output', () => {
  it('keeps a uniform nested Fill Frame while an outer owner becomes heterogeneous with fresh S/F/passes', async () => {
    installNested('fill');
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    const original = frame.candidate.preparedStart.gcode;
    expectFill(original, 800);
    expect(
      frame.candidate.preparedStart.prepared.job.groups.filter((group) => group.kind === 'fill'),
    ).toHaveLength(1);
    process('plate', 'fill', 35, 900, 2);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    const current = await startFresh(frame);
    expect(current.gcode).not.toBe(original);
    expectFill(current.gcode, 350, 800, 900);
    expect(ownedLength(current.gcode, 'plate')).toBeCloseTo(ownedLength(original, 'plate') * 2, 6);
    expect(ownedLength(current.gcode, 'island')).toBeCloseTo(ownedLength(original, 'island'), 6);
    const displayed = reviews.models
      .at(-1)
      ?.effectiveOperations.flatMap((row) => row.summaries)
      .join('\n');
    expect(displayed).toContain('35% power');
    expect(displayed).toContain('900 mm/min');
    expect(displayed).toContain('2 passes');
  });

  it('returns mixed nested Fill owners to the uniform fast path without discarding Frame', async () => {
    installNested('fill');
    process('plate', 'fill', 35);
    process('island', 'fill', 20);
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    expect(
      frame.candidate.preparedStart.prepared.job.groups.filter((group) => group.kind === 'fill')
        .length,
    ).toBeGreaterThan(1);
    process('plate', 'fill', 80);
    process('island', 'fill', 80);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    const current = await startFresh(frame);
    expect(current.job.groups.filter((group) => group.kind === 'fill')).toHaveLength(1);
    expectFill(current.gcode, 800);
    expect(current.gcode).not.toMatch(/S(?:200|350)(?:\s|$)/m);
  });

  it('re-prepares and re-reviews a nested Fill owner edit made inside Job Review', async () => {
    installNested('fill');
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    uninstallReview();
    let confirmations = 0;
    uninstallReview = installAutoJobReview(() => {
      if (confirmations++ === 0) process('plate', 'fill', 35, 900, 2);
      return 'confirm';
    });
    const repository = frameOnceRepository();
    await runStartJobFlow(repository);
    expect(confirmations).toBe(2);
    const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
    expect(calls).toHaveLength(1);
    const gcode = calls[0]?.[0];
    if (gcode === undefined) throw new Error('Expected fresh reviewed output.');
    expectFill(gcode, 350, 800, 900);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
    expect(
      useLaserStore.getState().completedFrame?.candidate.frameVerification.boundsSignature,
    ).toBe(frame.candidate.frameVerification.boundsSignature);
  });

  it('retains the combined Fill/Line footprint while each operation emits its new owner settings', async () => {
    installNested('mixed');
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    process('plate', 'fill', 35, 900, 2);
    process('island', 'line', 23, 700, 3);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    const current = await startFresh(frame);
    expectFill(current.gcode, 350, 800, 900);
    const lines = burns(current.gcode).filter((edge) => [550, 230].includes(edge.power));
    expect(contourOrder(lines)).toEqual(['island', 'hole', 'plate']);
    expect(lines.filter((edge) => ownerOf(edge) === 'island')).toHaveLength(12);
    expect(
      lines.filter((edge) => ownerOf(edge) === 'island').every((edge) => edge.feed === 700),
    ).toBe(true);
  });

  it.each([
    { name: 'closed', settings: {} },
    {
      name: 'tabs',
      settings: { tabsEnabled: true, tabSizeMm: 2, tabsPerShape: 2, tabSkipInnerShapes: false },
    },
    {
      name: 'perforation',
      settings: { perforationEnabled: true, perforationCutMm: 3, perforationSkipMm: 1 },
    },
  ])(
    'keeps the $name Line Frame and completes every island pass before its containing contours',
    async ({ settings }) => {
      installNested('line', settings);
      const frame = await installReviewPendingFramedRunPermitForCurrentState();
      const oldIslandLength = burns(frame.candidate.preparedStart.gcode)
        .filter((edge) => ownerOf(edge) === 'island')
        .reduce((sum, edge) => sum + burnLength(edge), 0);
      process('island', 'line', 23, 700, 2);
      expect(useLaserStore.getState().completedFrame).toBe(frame);
      const current = await startFresh(frame);
      const edges = burns(current.gcode);
      expect(contourOrder(edges)).toEqual(['island', 'hole', 'plate']);
      const island = edges.filter((edge) => ownerOf(edge) === 'island');
      expect(island.length).toBeGreaterThan(0);
      expect(island.every((edge) => edge.power === 230 && edge.feed === 700)).toBe(true);
      expect(island.reduce((sum, edge) => sum + burnLength(edge), 0)).toBeCloseTo(
        oldIslandLength * 2,
        6,
      );
    },
  );

  it.each([
    { name: 'explicit source order', travelPolicy: 'source-order' as const, insideFirst: true },
    { name: 'insideFirst=false', travelPolicy: 'nearest-neighbor' as const, insideFirst: false },
  ])('control: $name remains exact through a fresh heterogeneous Line Start', async (settings) => {
    installNested('line');
    useStore.getState().setProjectOptimization({
      travelPolicy: settings.travelPolicy,
      insideFirst: settings.insideFirst,
    });
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    process('island', 'line', 23, 700, 2);
    const current = await startFresh(frame);
    expect(contourOrder(burns(current.gcode))).toEqual(['plate', 'hole', 'island']);
  });

  it.each(['move', 'resize'])(
    'control: an actual %s still discards Frame and sends no program',
    async (change) => {
      installNested('mixed');
      const frame = await installReviewPendingFramedRunPermitForCurrentState();
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) =>
              object.id !== 'plate'
                ? object
                : {
                    ...object,
                    transform: {
                      ...object.transform,
                      ...(change === 'move' ? { x: 1 } : { scaleX: 1.1 }),
                    },
                  },
            ),
          },
        },
      }));
      expect(useLaserStore.getState().completedFrame).toBeNull();
      await runStartJobFlow(frameOnceRepository());
      expect(vi.mocked(useLaserStore.getState().startJob)).not.toHaveBeenCalled();
      expect(useLaserStore.getState().frameVerification).not.toBe(
        frame.candidate.frameVerification,
      );
    },
  );

  it('control: changed resolved placement requires another Frame', async () => {
    installNested('mixed');
    await installReviewPendingFramedRunPermitForCurrentState();
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    expect(useLaserStore.getState().completedFrame).toBeNull();
    await runStartJobFlow(frameOnceRepository());
    expect(vi.mocked(useLaserStore.getState().startJob)).not.toHaveBeenCalled();
  });
});
