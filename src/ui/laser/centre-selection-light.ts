import {
  headPositionToNative,
  nativeToHeadPosition,
} from '../../core/devices/head-position-frames';
import { positioningLightIssue } from '../../core/devices/positioning-light';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf, type Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { headFrameContext, HEAD_MOVE_UNVERIFIED_BED } from './head-move-dispatch';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { selectionAnchorScenePoint } from './move-laser-to-selection';
import { resolveFrameCandidate } from './frame-candidate';

/** Resolve the pointer's spot, not the cutting head, to the selected world bounds. */
export async function centreSelectionLight(): Promise<void> {
  assertCentreLightAvailable();
  const app = useStore.getState();
  const centre = selectionAnchorScenePoint(app.project, selectedObjectIds(app), 'c');
  if (centre === null) throw new Error('Select a trace or other artwork to centre the light on.');
  await centreLightOnBedPoint(centre);
}

/** True when Machine Setup asks Frame to finish with Centre & LED and this
 * project can use it; Frame itself stays independent of the light. */
export function centreLightAfterFrameWanted(): boolean {
  if (useStore.getState().project.device.positioningLight?.afterFrame !== true) return false;
  try {
    assertCentreLightAvailable();
    return true;
  } catch {
    return false;
  }
}

/** Point the light at the centre of the job the completed Frame traced (ADR-604). */
export async function centreLightOnFramedArtwork(): Promise<void> {
  assertCentreLightAvailable();
  const laser = useLaserStore.getState();
  const frame = laser.framedRun ?? laser.completedFrame ?? null;
  if (frame === null) throw new Error('Frame the job before centring the light on it.');
  const bounds = resolveFrameCandidate(frame.candidate.preparedStart);
  if (!bounds.ok) throw new Error(bounds.messages.join(' '));
  const { jobBounds } = bounds;
  const context = headFrameContext(laser);
  if (context.workOffsetMm === null) throw new Error('Wait for the controller work offset.');
  // Job bounds are G-code work coordinates; the light offset is along the bed axes.
  const bed = nativeToHeadPosition(
    {
      x: (jobBounds.minX + jobBounds.maxX) / 2 + context.workOffsetMm.x,
      y: (jobBounds.minY + jobBounds.maxY) / 2 + context.workOffsetMm.y,
    },
    'bed',
    context,
  );
  if (bed === null) throw new Error('Wait for the controller work offset.');
  await centreLightOnBedPoint({ x: bed.xMm, y: bed.yMm });
}

function assertCentreLightAvailable(): void {
  const { project, jobPlacement } = useStore.getState();
  const issue = positioningLightIssue(
    project.device.positioningLight,
    project.device.controllerKind,
  );
  if (project.device.positioningLight === undefined || issue !== null)
    throw new Error(issue ?? 'Set up the separate positioning light in Machine Setup first.');
  if (project.device.controllerKind === 'ruida')
    throw new Error(
      'Ruida is file export only. Position the head and switch its light at the machine.',
    );
  if (machineKindOf(project.machine) !== 'laser')
    throw new Error('Centre & LED is available in Laser mode.');
  if (jobPlacement.startFrom !== 'absolute')
    throw new Error('Centre & LED needs Absolute Coords. Use Frame for origin-based placement.');
  if (rotaryAppliesTo(project.device, project.machine))
    throw new Error('Centre & LED needs a flat bed; a rotary canvas Y is not a bed position.');
}

async function centreLightOnBedPoint(centre: Vec2): Promise<void> {
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
  await laser.centrePositioningLight(resolved.point.x, resolved.point.y, feed);
}
