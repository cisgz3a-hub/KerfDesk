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
      'wcoCache' | 'ovCache' | 'accessoryCache' | 'workOriginActive' | 'workOriginSource'
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
  if (state.positionEvidenceSuppressed === true) {
    return {
      statusReport: { ...report, mPos: null, wPos: null, wco: null },
      ...ovPatch,
      ...accessoryPatch,
      wcoCache: null,
    };
  }
  if (report.wco === null) return { statusReport: report, ...ovPatch, ...accessoryPatch };
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
    wcoCache: report.wco,
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(state.workOriginSource) : 'none',
  };
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
