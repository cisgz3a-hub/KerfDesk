import { profileSupportsCapability } from '../../core/devices';
import { parseActiveWcsFromModalResponses } from '../../core/controllers/grbl/work-offset-readback';
import {
  parseSurfaceContact,
  surfaceGridModalContext,
  surfaceGridPositions,
  surfaceGridRetouchPlan,
  surfaceNumber,
  validateSurfaceContact,
  validateSurfaceGrid,
  type SurfaceGridMeasurement,
  type SurfaceGridRequest,
  type SurfaceGridResult,
  type SurfacePoint,
} from '../../core/controllers/grbl/surface-grid-probe';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import { spindleOffBlockReason } from './laser-probe-policy';
import { useStore } from './store';
import type { LiveRefs, LaserState } from './laser-store';
import type { SafeWrite } from './laser-safe-write';
import {
  SurfaceProbeTransaction,
  surfaceProbeMessage,
  type SurfaceProbeSet,
} from './surface-probe-transaction';

export function surfaceProbeBlockReason(state: LaserState): string | null {
  const device = useStore.getState().project.device;
  if (
    !['grbl-v1.1', 'grblhal', 'fluidnc'].includes(state.activeControllerKind) ||
    state.activeControllerCommandSet !== null ||
    !state.capabilities.probing
  )
    return 'Measured grids require the documented GRBL-family probe protocol.';
  if (!profileSupportsCapability(device, 'z-axis') || device.zProbePresent !== true)
    return 'Declare a powered Z axis and installed probe in the device profile before measuring.';
  const busy = machineSettingsReadBlockReason(state);
  if (busy !== null) return busy;
  if (state.statusReport?.state !== 'Idle')
    return 'The controller must report Idle before measuring a surface.';
  if (!surfaceReportUnitsKnown(state))
    return 'Read current-session controller settings to establish the coordinate report units first.';
  return spindleOffBlockReason(state.statusReport.spindle, state.accessoryCache);
}

function surfaceReportUnitsKnown(state: LaserState): boolean {
  return (
    !state.positionEvidenceSuppressed &&
    !state.reportUnitsUnconfirmed &&
    state.controllerSettings?.reportInches !== undefined &&
    state.controllerSettingsObservation?.sessionEpoch === state.controllerSessionEpoch
  );
}

export function surfaceProbeActions(
  set: SurfaceProbeSet,
  get: () => LaserState,
  refs: LiveRefs,
  write: SafeWrite,
): Pick<LaserState, 'measureSurfaceGrid'> {
  return {
    measureSurfaceGrid: async (request) => {
      try {
        validateSurfaceGrid(request);
        const blocked = surfaceProbeBlockReason(get());
        if (blocked !== null) throw new Error(blocked);
        const transaction = new SurfaceProbeTransaction(set, get, refs, write);
        return await runSurfaceGrid(transaction, request);
      } catch (error) {
        return { kind: 'failed', reason: surfaceProbeMessage(error) };
      }
    },
  };
}

async function runSurfaceGrid(
  transaction: SurfaceProbeTransaction,
  request: SurfaceGridRequest,
): Promise<SurfaceGridResult> {
  const points: SurfacePoint[] = [];
  transaction.reserve();
  try {
    const context = await captureSurfaceContext(transaction, request);
    transaction.context = context;
    transaction.beginMotion();
    for (const off of transaction.driver.commands.frameToolOffLines) await transaction.send(off);
    await transaction.send('G21 G90 G94');
    for (const point of surfaceGridPositions(request))
      points.push(await measurePoint(transaction, context, point));
    await transaction.settle();
    return {
      kind: 'ok',
      measurement: { ...context, points, complete: true, measuredAt: Date.now() },
    };
  } catch (error) {
    await transaction.fail(error);
    const context = transaction.context;
    return {
      kind: 'failed',
      reason: surfaceProbeMessage(error),
      ...(context === null
        ? {}
        : { measurement: { ...context, points, complete: false, measuredAt: Date.now() } }),
    };
  }
}

async function captureSurfaceContext(
  transaction: SurfaceProbeTransaction,
  request: SurfaceGridRequest,
): Promise<Omit<SurfaceGridMeasurement, 'points' | 'complete' | 'measuredAt'>> {
  const modal = await transaction.send(transaction.modalQuery);
  const offsets = await transaction.send(transaction.offsetsQuery);
  const activeWcs = surfaceGridModalContext(modal, offsets);
  const afterModal = await transaction.send(transaction.modalQuery);
  if (parseActiveWcsFromModalResponses(afterModal) !== activeWcs)
    throw new Error('Active work coordinates changed before measurement.');
  const clearance = await transaction.freshPosition();
  transaction.assertSpindleOff();
  return {
    request: { ...request },
    activeWcs,
    offsetMm: clearance.offset,
    clearanceZMm: Number(surfaceNumber(clearance.z)),
    reportInches: transaction.reportInches,
    sessionEpoch: transaction.sessionEpoch,
  };
}

async function measurePoint(
  transaction: SurfaceProbeTransaction,
  context: Omit<SurfaceGridMeasurement, 'points' | 'complete' | 'measuredAt'>,
  point: Omit<SurfacePoint, 'z' | 'machineZ'>,
): Promise<SurfacePoint> {
  const request = context.request;
  await transaction.send(`G90 G1 Z${surfaceNumber(context.clearanceZMm)} F${request.travelFeed}`);
  await transaction.send(
    `G90 G1 X${surfaceNumber(point.x)} Y${surfaceNumber(point.y)} F${request.travelFeed}`,
  );
  const fast = parseSurfaceContact(
    await transaction.send(
      `G91 G38.2 Z-${surfaceNumber(request.maxTravelMm)} F${request.seekFeed}`,
    ),
    context.reportInches,
  );
  const fastWorkZ = validateSurfaceContact(
    fast,
    point,
    context.offsetMm,
    context.clearanceZMm,
    request.maxTravelMm,
  );
  const retouch = surfaceGridRetouchPlan(fastWorkZ, context.clearanceZMm, request.maxTravelMm);
  await transaction.send(`G90 G1 Z${surfaceNumber(retouch.retractZMm)} F${request.travelFeed}`);
  const contact = parseSurfaceContact(
    await transaction.send(
      `G90 G38.2 Z${surfaceNumber(retouch.slowTargetZMm)} F${request.probeFeed}`,
    ),
    context.reportInches,
  );
  const z = validateSurfaceContact(
    contact,
    point,
    context.offsetMm,
    retouch.retractZMm,
    retouch.retractZMm - retouch.slowTargetZMm,
  );
  await transaction.send(`G90 G1 Z${surfaceNumber(context.clearanceZMm)} F${request.travelFeed}`);
  await transaction.send(transaction.driver.commands.settleDwell);
  const settled = await transaction.freshPosition();
  if (Math.abs(settled.z - context.clearanceZMm) > 0.02)
    throw new Error('Z did not return to the captured clearance plane.');
  const currentModal = await transaction.send(transaction.modalQuery);
  if (parseActiveWcsFromModalResponses(currentModal) !== context.activeWcs)
    throw new Error('Active WCS changed during surface measurement.');
  return { ...point, z, machineZ: contact.z };
}
