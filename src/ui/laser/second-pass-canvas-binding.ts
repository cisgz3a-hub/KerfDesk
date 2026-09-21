import type { PreparedStartProgram } from '../state/framed-run';
import type { useLaserStore } from '../state/laser-store';
import {
  canvasCapability,
  canvasCoordinateFrame,
  capabilityReason,
  mapControllerPointToScene,
  reportedWorkPositionMm,
} from '../state/canvas-motion-plan';
import { registerCanvasProgramSource } from '../state/canvas-program-source';

/** Standalone painting uses work-coordinate geometry. The running canvas
 * instead follows the current controller's WCO/origin and status capability. */
export function bindSecondPassCanvasToController(
  prepared: PreparedStartProgram,
  laser: ReturnType<typeof useLaserStore.getState>,
): PreparedStartProgram {
  const reportInches = laser.controllerSettings?.reportInches === true;
  const coordinateFrame = canvasCoordinateFrame(
    prepared.prepared,
    { ...laser, hasActiveStreamer: false },
    reportInches,
    prepared.jobOrigin,
    false,
  );
  const capability = canvasCapability(laser.capabilities.statusQuery, false);
  const mapping = { device: prepared.prepared.project.device, coordinateFrame };
  const initial = reportedWorkPositionMm(laser, reportInches);
  const firstProcess = prepared.canvasPlan.manifest.firstProcessPoint;
  const bounds = prepared.metrics.frameMotionBounds;
  const canvasPlan = {
    ...prepared.canvasPlan,
    ...mapping,
    capability,
    unavailableReason: capabilityReason(capability, false),
    positionEpoch: laser.trustedPositionEpoch ?? 0,
    approachFrom: initial === null ? null : mapControllerPointToScene(initial, mapping),
    jobStart: firstProcess === null ? null : mapControllerPointToScene(firstProcess, mapping),
    framePerimeter:
      bounds === null || capability === 'file-only'
        ? []
        : [
            { x: bounds.minX, y: bounds.minY, z: 0 },
            { x: bounds.maxX, y: bounds.minY, z: 0 },
            { x: bounds.maxX, y: bounds.maxY, z: 0 },
            { x: bounds.minX, y: bounds.maxY, z: 0 },
            { x: bounds.minX, y: bounds.minY, z: 0 },
          ].map((point) => mapControllerPointToScene(point, mapping)),
  };
  registerCanvasProgramSource(canvasPlan, prepared.gcode);
  return { ...prepared, canvasPlan };
}
