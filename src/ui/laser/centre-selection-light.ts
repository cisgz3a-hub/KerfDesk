import { headPositionToNative } from '../../core/devices/head-position-frames';
import { positioningLightIssue } from '../../core/devices/positioning-light';
import { rotaryAppliesTo } from '../../core/job/rotary-job';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';
import { headFrameContext, HEAD_MOVE_UNVERIFIED_BED } from './head-move-dispatch';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { selectionAnchorScenePoint } from './move-laser-to-selection';

/** Resolve the pointer's spot, not the cutting head, to the selected world bounds. */
export async function centreSelectionLight(): Promise<void> {
  const app = useStore.getState();
  const { project } = app;
  const light = project.device.positioningLight;
  const issue = positioningLightIssue(light, project.device.controllerKind);
  if (light === undefined || issue !== null)
    throw new Error(issue ?? 'Set up the separate positioning light in Machine Setup first.');
  if (machineKindOf(project.machine) !== 'laser')
    throw new Error('Centre & LED is available in Laser mode.');
  if (app.jobPlacement.startFrom !== 'absolute')
    throw new Error('Centre & LED needs Absolute Coords. Use Frame for origin-based placement.');
  if (rotaryAppliesTo(project.device, project.machine))
    throw new Error('Centre & LED needs a flat bed; a rotary canvas Y is not a bed position.');
  const centre = selectionAnchorScenePoint(project, selectedObjectIds(app), 'c');
  if (centre === null) throw new Error('Select a trace or other artwork to centre the light on.');
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
