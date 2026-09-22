import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { hasCustomXyOrigin } from './origin-actions';

export function statusPositionPatch(
  state: LaserState,
  report: StatusReport,
): Pick<LaserState, 'statusReport'> &
  Partial<
    Pick<
      LaserState,
      | 'wcoCache'
      | 'ovCache'
      | 'accessoryCache'
      | 'airAssistOn'
      | 'workOriginActive'
      | 'workOriginSource'
    >
  > {
  // Ov: is reported on the same intermittent cadence as WCO — cache the
  // last-seen values so the overrides readout doesn't flicker (ADR-103 G3).
  const ovPatch = report.ov === null || report.ov === undefined ? {} : { ovCache: report.ov };
  // A: is intermittent with Ov:. Preserve the last state on frames carrying
  // neither field; the parser turns Ov-without-A into a known all-off value.
  const accessoryPatch =
    report.accessories === null || report.accessories === undefined
      ? {}
      : {
          accessoryCache: {
            ...report.accessories,
            ...(state.accessoryCache?.secondarySpindlePresent === true
              ? { secondarySpindlePresent: true }
              : {}),
            ...exceptionalAccessoryLatch(state.accessoryCache, report.accessoryReportPresent),
          },
        };
  const airPatch = manualAirPatch(report);
  if (state.positionEvidenceSuppressed === true || state.reportUnitsUnconfirmed === true) {
    return {
      statusReport: { ...report, mPos: null, wPos: null, wco: null },
      ...ovPatch,
      ...accessoryPatch,
      ...airPatch,
      wcoCache: null,
    };
  }
  if (report.wco === null) {
    return { statusReport: report, ...ovPatch, ...accessoryPatch, ...airPatch };
  }
  // A non-trivial WCO always means a custom origin. A zero WCO is ambiguous: on a
  // no-homing machine the operator sets the origin right after Release/Wake, when
  // GRBL sits at machine 0,0, so the resulting G92 offset is exactly zero. That
  // is a deliberate origin, not the absence of one — a routine zero-WCO frame
  // must NOT demote it. An actual reset/alarm/clear drops workOriginSource to
  // 'none' first (originUnknownAfterControllerReset / clearedOriginPatch), so
  // keying on the source here cannot revive a stale origin.
  const active = hasCustomXyOrigin(report.wco) || state.workOriginSource !== 'none';
  return {
    statusReport: report,
    ...ovPatch,
    ...accessoryPatch,
    ...airPatch,
    wcoCache: report.wco,
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(state.workOriginSource) : 'none',
  };
}

// Manual Air mirrors the controller's own coolant state whenever a frame
// proves it: an explicit `A:` field, or `Ov:` without `A:` (GRBL omits `A:`
// when nothing is energized). Vendor auto-focus routines, the probe preamble
// (M5 M9), job and frame footers, and soft resets all switch coolant off
// behind the app's back; the rail kept showing ON, and the next click sent
// M9 to an already-off pump (maintainer, 2026-09-19: "air assist works for a
// while and then stops"). Frames carrying neither field prove nothing and
// leave the flag alone, so an in-flight M8 is not undone by a stale report.
function manualAirPatch(report: StatusReport): Partial<Pick<LaserState, 'airAssistOn'>> {
  const accessories = report.accessories;
  if (accessories === null || accessories === undefined) return {};
  const proven =
    report.accessoryReportPresent === true || (report.ov !== null && report.ov !== undefined);
  if (!proven) return {};
  return { airAssistOn: accessories.flood || accessories.mist };
}

function exceptionalAccessoryLatch(
  previous: LaserState['accessoryCache'],
  explicitAccessoryReport: boolean | undefined,
): Partial<NonNullable<LaserState['accessoryCache']>> {
  if (explicitAccessoryReport === true) return {};
  return {
    ...(previous?.spindleEncoderFault === true ? { spindleEncoderFault: true } : {}),
    ...(previous?.toolChangePending === true ? { toolChangePending: true } : {}),
  };
}

function knownOrUnknownOriginSource(
  source: LaserState['workOriginSource'],
): LaserState['workOriginSource'] {
  return source === 'none' ? 'unknown' : source;
}
