import {
  headPositionToNative,
  nativeToHeadPosition,
} from '../../core/devices/head-position-frames';
import { devicePositioningLightIssue } from '../../core/devices/positioning-light';
import { toMachineCoords, toSceneCoords } from '../../core/devices/origin-transform';
import { computeFrameBounds, type JobBounds } from '../../core/job';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf, type Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { placementAssumesZeroWorkOffset } from '../job-placement';
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
  const centre = selectedCentre(prepared.project, ids, true);
  const machine = toMachineCoords(centre, prepared.project.device);
  await centreLightOnFramedPoint(
    { x: machine.x + prepared.jobOriginOffset.x, y: machine.y + prepared.jobOriginOffset.y },
    frame,
    current,
    assertTargetCurrent,
  );
}

function selectedCentre(
  project: ReturnType<typeof useStore.getState>['project'],
  ids: string[],
  framedOutput = false,
): Vec2 {
  const objects = new Map(project.scene.objects.map((object) => [object.id, object]));
  let bounds: JobBounds | null = null;
  for (const id of ids) {
    const object = objects.get(id);
    // Prepared scenes retain disabled artwork and paths. Frame's output bounds
    // prove membership and measure only the enabled paths of every chosen member.
    const output =
      framedOutput && object !== undefined
        ? computeFrameBounds({ ...project.scene, objects: [object] }, project.device)
        : null;
    if (object === undefined || (framedOutput && output === null))
      throw new Error(
        'The chosen artwork was not included in this Frame. Frame that artwork first.',
      );
    if (output !== null)
      bounds =
        bounds === null
          ? output
          : {
              minX: Math.min(bounds.minX, output.minX),
              minY: Math.min(bounds.minY, output.minY),
              maxX: Math.max(bounds.maxX, output.maxX),
              maxY: Math.max(bounds.maxY, output.maxY),
            };
  }
  const centre =
    bounds === null
      ? selectionAnchorScenePoint(project, ids, 'c')
      : toSceneCoords(
          { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
          project.device,
        );
  return requireFiniteArtworkCentre(centre);
}

function requireFiniteArtworkCentre(centre: Vec2 | null): Vec2 {
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
  await centreLightOnFramedPoint(
    { x: (jobBounds.minX + jobBounds.maxX) / 2, y: (jobBounds.minY + jobBounds.maxY) / 2 },
    frame,
    current,
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
      current.projectDocumentEpoch !== app.projectDocumentEpoch ||
      (frame === null &&
        (current.project !== app.project || current.jobPlacement !== app.jobPlacement)) ||
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

async function centreLightOnFramedPoint(
  point: Vec2,
  frame: FramedRunPermit,
  laser: LaserState,
  assertTargetCurrent: () => void,
): Promise<void> {
  if (headFrameContext(laser).workOffsetMm !== null) {
    await centreLightOnBedPoint(framedWorkPointToBed(point, laser), assertTargetCurrent);
    return;
  }
  const startFrom = frame.candidate.preparedStart.jobOrigin?.startFrom ?? 'absolute';
  const assumedZero = placementAssumesZeroWorkOffset(startFrom, frame.controller);
  if (startFrom !== 'verified-origin' && !assumedZero)
    throw new Error('Wait for the controller work offset.');
  // Reuse only the assumption already captured by a completed Frame. Work-only
  // reports retain the real trace even when its unknown native offset is nonzero.
  const coordinateFrame = assumedZero && laser.statusReport?.wPos == null ? 'machine' : 'work';
  if (assumedZero) useToastStore.getState().pushToast(HEAD_MOVE_UNVERIFIED_BED, 'warning');
  const device = frame.candidate.preparedStart.prepared.project.device;
  const light = device.positioningLight;
  if (light === undefined) throw new Error('Set up the separate positioning light first.');
  // Only the offset vector needs the device transform; its translation cancels.
  // The captured work target remains truthful even when the native origin is unknown.
  const zero = toMachineCoords({ x: 0, y: 0 }, device);
  const pointer = toMachineCoords({ x: light.offsetXmm, y: light.offsetYmm }, device);
  const feed = clampJogFeed(
    useJogControlPreferences.getState().requestedFeedMmPerMin,
    device.maxFeed,
  );
  await laser.centrePositioningLight(
    point.x - pointer.x + zero.x,
    point.y - pointer.y + zero.y,
    feed,
    assertTargetCurrent,
    coordinateFrame,
  );
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
    currentApp.projectDocumentEpoch !== app.projectDocumentEpoch ||
    currentFrameSpatialSignature(currentApp) !== currentFrameSpatialSignature(app)
  )
    throw new Error('The framed artwork or positioning request changed before the LED move.');
  const changed = framedRunStartHandoffIssue(frame, current);
  if (changed !== null) throw new Error(changed);
  return current;
}

function assertCentreLightAvailable(framed = false): void {
  const { project, jobPlacement } = useStore.getState();
  // The dialect matters: on a Marlin fan-mosfet profile M106/M107 fire the laser.
  const issue = devicePositioningLightIssue(project.device);
  if (project.device.positioningLight === undefined || issue !== null)
    throw new Error(issue ?? 'Set up the separate positioning light in Machine Setup first.');
  if (project.device.controllerKind === 'ruida' || project.device.controllerKind === 'lihuiyu')
    throw new Error(
      'This controller has no live light control. Position the head and switch its light at the machine.',
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
