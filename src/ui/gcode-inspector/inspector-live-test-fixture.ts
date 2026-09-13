import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { createStreamer, type StreamerState } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { startLiveCanvasRun, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import {
  registerCanvasProgramRun,
  registerCanvasProgramSource,
} from '../state/canvas-program-source';

export const LIVE_PROGRAM = '; header\nG21 G90\n\nM3 S500\nG1 X10 F600\nG1 Y10\nM5';

export function liveInspectorModel(text = LIVE_PROGRAM): GcodeRenderModel {
  const parsed = buildGcodeRenderModel(text);
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return parsed.model;
}

export function liveInspectorRun(text = LIVE_PROGRAM) {
  const plan: CanvasMotionPlan = {
    manifest: buildMotionManifest(text, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(text),
    retentionKey: text,
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
  registerCanvasProgramSource(plan, text);
  return {
    ...startLiveCanvasRun(plan),
    reportedHead: { x: 5, y: 0, z: 0 },
    route: { confirmedRouteMm: 5, uncertain: false, candidates: [] },
  };
}

export function liveInspectorState(
  text = LIVE_PROGRAM,
  status: StreamerState['status'] = 'streaming',
) {
  const liveCanvasRun = liveInspectorRun(text);
  const streamer = { ...createStreamer(text), status };
  registerCanvasProgramRun(liveCanvasRun.plan, streamer.queued, liveCanvasRun.startedAtMs);
  return { liveCanvasRun, streamer };
}
