import {
  headPositionToNative,
  nativeToHeadPosition,
} from '../../core/devices/head-position-frames';
import { positioningLightIssue } from '../../core/devices/positioning-light';
import { toMachineCoords } from '../../core/devices/origin-transform';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf, type Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { framedRunStartHandoffIssue, type FramedRunPermit } from '../state/framed-run';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { headFrameContext, HEAD_MOVE_UNVERIFIED_BED } from './head-move-dispatch';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { selectionAnchorScenePoint } from './move-laser-to-selection';
import { resolveFrameCandidate } from './frame-candidate';
import { frameControllerQueueIssue } from './frame-controller-readiness';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { currentFrameSpatialSignature } from './frame-spatial-identity';

/** Point at one explicitly chosen artwork/group in the captured Frame placement. */
export async function centreSelectionLight(objectIds?: ReadonlyArray<string>): Promise<void> {
  assertCentreLightAvailable(true);
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const frame = laser.framedRun ?? laser.completedFrame ?? null;
  const assertPlacementCurrent = artworkPlacementGuard(app, frame);
  const ids = [...new Set(objectIds ?? selectedObjectIds(app))];
  const existing = new Set(app.project.scene.objects.map((object) => object.id));
  const assertTargetCurrent = (): void => {
    const current = useStore.getState();
    assertPlacementCurrent();
    const selected = new Set(selectedObjectIds(current));
    if (ids.length === 0 || ids.some((id) => !selected.has(id) || !existing.has(id)))
      throw new Error('Select the artwork to centre the light on again.');
  };
  assertTargetCurrent();
  if (frame === null) {
    assertCentreLightAvailable();
    const centre = selectedCentre(app.project, ids);
    await centreLightOnBedPoint(centre, assertTargetCurrent);
    return;
  }
  if (frame.candidate.authorizationContext !== undefined)
    throw new Error('Frame the ordinary artwork job before centring this artwork.');
  const issue = framedRunReadinessIssue(frame, app, laser);
  if (issue !== null) throw new Error(issue);
  assertFramedLightCurrent(frame, laser, app);
  if ((await frameControllerQueueIssue()) !== null)
    throw new Error(
      'The final controller reply is still missing; the positioning light stays off.',
    );
  const current = assertFramedLightCurrent(frame, laser, app);
  assertTargetCurrent();
  const prepared = frame.candidate.preparedStart.prepared;
  // This snapshot also contains evaluated text and Print-and-Cut registration.
  // Re-anchoring a chosen subset would move it away from the framed whole job.
  const centre = selectedCentre(prepared.project, ids);
  const machine = toMachineCoords(centre, prepared.project.device);
  await centreLightOnBedPoint(
    framedWorkPointToBed(
      {
        x: machine.x + prepared.jobOriginOffset.x,
        y: machine.y + prepared.jobOriginOffset.y,
      },
      current,
    ),
    assertTargetCurrent,
  );
}

function selectedCentre(
  project: ReturnType<typeof useStore.getState>['project'],
  ids: string[],
): Vec2 {
  const existing = new Set(project.scene.objects.map((object) => object.id));
  if (ids.some((id) => !existing.has(id)))
    throw new Error('The chosen artwork was not included in this Frame. Frame that artwork first.');
  const centre = selectionAnchorScenePoint(project, ids, 'c');
  if (centre === null || !Number.isFinite(centre.x) || !Number.isFinite(centre.y))
    throw new Error('The chosen artwork has no finite centre to position the light on.');
  return centre;
}

/** True when Machine Setup asks Frame to finish with Centre & LED and this
 * project can use it; Frame itself stays independent of the light. */
export function centreLightAfterFrameWanted(): boolean {
  if (useStore.getState().project.device.positioningLight?.afterFrame !== true) return false;
  try {
    assertCentreLightAvailable(true);
    return true;
  } catch {
    return false;
  }
}

/** Point the light at the centre of the job the completed Frame traced (ADR-605). */
export async function centreLightOnFramedArtwork(): Promise<void> {
  assertCentreLightAvailable(true);
  const laser = useLaserStore.getState();
  const app = useStore.getState();
  const frame = laser.framedRun ?? laser.completedFrame ?? null;
  if (frame === null) throw new Error('Frame the job before centring the light on it.');
  if (frame.candidate.authorizationContext !== undefined)
    throw new Error('Centre the light only after framing the ordinary artwork job.');
  const assertTargetCurrent = artworkPlacementGuard(app, frame);
  assertFramedLightCurrent(frame, laser, app);
  // A queued M114 can publish Frame's final position before its terminal ACK.
  // Drain that reply before the light claims the controller; never adopt a new Frame.
  if ((await frameControllerQueueIssue()) !== null)
    throw new Error(
      'The final controller reply is still missing; the positioning light stays off.',
    );
  const current = assertFramedLightCurrent(frame, laser, app);
  const bounds = resolveFrameCandidate(frame.candidate.preparedStart);
  if (!bounds.ok) throw new Error(bounds.messages.join(' '));
  const { jobBounds } = bounds;
  await centreLightOnBedPoint(
    framedWorkPointToBed(
      { x: (jobBounds.minX + jobBounds.maxX) / 2, y: (jobBounds.minY + jobBounds.maxY) / 2 },
      current,
    ),
    assertTargetCurrent,
  );
}

function artworkPlacementGuard(
  app: ReturnType<typeof useStore.getState>,
  frame: FramedRunPermit | null,
): () => void {
  const spatialSignature = currentFrameSpatialSignature(app);
  return () => {
    const current = useStore.getState();
    if (
      current.project !== app.project ||
      current.jobPlacement !== app.jobPlacement ||
      currentFrameSpatialSignature(current) !== spatialSignature
    )
      throw new Error('The artwork or placement changed before the LED move.');
    if (frame !== null) {
      // Owned LED travel changes the head position, not its coordinate session.
      const changed = framedRunStartHandoffIssue(frame, {
        ...useLaserStore.getState(),
        statusReport: frame.controller.statusReport,
      });
      if (changed !== null) throw new Error(changed);
    }
  };
}

function framedWorkPointToBed(point: Vec2, laser: LaserState): Vec2 {
  const context = headFrameContext(laser);
  if (context.workOffsetMm === null) throw new Error('Wait for the controller work offset.');
  // Prepared points are G-code work coordinates; the LED offset is in bed axes.
  const bed = nativeToHeadPosition(
    { x: point.x + context.workOffsetMm.x, y: point.y + context.workOffsetMm.y },
    'bed',
    context,
  );
  if (bed === null) throw new Error('Wait for the controller work offset.');
  return { x: bed.xMm, y: bed.yMm };
}

function assertFramedLightCurrent(
  frame: FramedRunPermit,
  laser: LaserState,
  app: ReturnType<typeof useStore.getState>,
): LaserState {
  const current = useLaserStore.getState();
  const currentApp = useStore.getState();
  if (
    (current.framedRun ?? current.completedFrame) !== frame ||
    current.manualMotionCancelEpoch !== laser.manualMotionCancelEpoch ||
    currentApp.project !== app.project ||
    currentApp.jobPlacement !== app.jobPlacement
  )
    throw new Error('The framed artwork or positioning request changed before the LED move.');
  const changed = framedRunStartHandoffIssue(frame, current);
  if (changed !== null) throw new Error(changed);
  return current;
}

function assertCentreLightAvailable(framed = false): void {
  const { project, jobPlacement } = useStore.getState();
  // The dialect matters: on a Marlin fan-mosfet profile M106/M107 fire the laser.
  const issue = positioningLightIssue(
    project.device.positioningLight,
    project.device.controllerKind,
    project.device.gcodeDialect?.dialectId,
  );
  if (project.device.positioningLight === undefined || issue !== null)
    throw new Error(issue ?? 'Set up the separate positioning light in Machine Setup first.');
  if (project.device.controllerKind === 'ruida')
    throw new Error(
      'Ruida is file export only. Position the head and switch its light at the machine.',
    );
  if (machineKindOf(project.machine) !== 'laser')
    throw new Error('Centre & LED is available in Laser mode.');
  if (!framed && jobPlacement.startFrom !== 'absolute')
    throw new Error('Centre & LED needs Absolute Coords. Use Frame for origin-based placement.');
  if (rotaryAppliesTo(project.device, project.machine))
    throw new Error('Centre & LED needs a flat bed; a rotary canvas Y is not a bed position.');
}

async function centreLightOnBedPoint(
  centre: Vec2,
  assertTargetCurrent?: () => void,
): Promise<void> {
  const { project } = useStore.getState();
  const light = project.device.positioningLight;
  if (light === undefined)
    throw new Error('Set up the separate positioning light in Machine Setup first.');
  const laser = useLaserStore.getState();
  const resolved = headPositionToNative(
    {
      frame: 'bed',
      xMm: centre.x - light.offsetXmm,
      yMm: centre.y - light.offsetYmm,
    },
    headFrameContext(laser),
  );
  if (resolved.kind !== 'native') throw new Error('Wait for the controller work offset.');
  if (!resolved.verified) useToastStore.getState().pushToast(HEAD_MOVE_UNVERIFIED_BED, 'warning');
  const feed = clampJogFeed(
    useJogControlPreferences.getState().requestedFeedMmPerMin,
    project.device.maxFeed,
  );
  if (assertTargetCurrent === undefined)
    await laser.centrePositioningLight(resolved.point.x, resolved.point.y, feed);
  else
    await laser.centrePositioningLight(
      resolved.point.x,
      resolved.point.y,
      feed,
      assertTargetCurrent,
    );
}
