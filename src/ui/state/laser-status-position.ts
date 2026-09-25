import type { StatusReport } from '../../core/controllers/grbl';
import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import type { LaserState } from './laser-store';
import { hostRecordedWorkOffset } from './host-recorded-origin';
import { hasCustomXyOrigin, type WorkCoordinateOffset } from './origin-actions';

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
  const ovPatch =
    report.ov === null || report.ov === undefined
      ? {}
      : { ovCache: unchangedOr(state.ovCache, report.ov) };
  // A: is intermittent with Ov:. Preserve the last state on frames carrying
  // neither field; the parser turns Ov-without-A into a known all-off value.
  const accessoryPatch =
    report.accessories === null || report.accessories === undefined
      ? {}
      : {
          accessoryCache: unchangedOr(state.accessoryCache, {
            ...report.accessories,
            ...(state.accessoryCache?.secondarySpindlePresent === true
              ? { secondarySpindlePresent: true }
              : {}),
            ...exceptionalAccessoryLatch(state.accessoryCache, report.accessoryReportPresent),
          }),
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
  const frameWco = reportedWorkOffset(state, report);
  if (frameWco === null) {
    return { statusReport: report, ...ovPatch, ...accessoryPatch, ...airPatch };
  }
  // A non-trivial WCO always means a custom origin. A zero WCO is ambiguous: on a
  // no-homing machine the operator sets the origin right after Release/Wake, when
  // GRBL sits at machine 0,0, so the resulting G92 offset is exactly zero. That
  // is a deliberate origin, not the absence of one — a routine zero-WCO frame
  // must NOT demote it. Only an explicit app-set origin carries that intent;
  // 'unknown' after Home/reset is reconciled by this fresh WCO, not latched
  // forever. Classify in mm while retaining the original report-unit cache.
  const active = hasActiveXyOrigin(state, frameWco);
  return {
    statusReport: withHostRecordedMachinePosition(state, report, frameWco),
    ...ovPatch,
    ...accessoryPatch,
    ...airPatch,
    wcoCache: unchangedOr(state.wcoCache, frameWco),
    workOriginActive: active,
    workOriginSource: active ? knownOrUnknownOriginSource(state.workOriginSource) : 'none',
  };
}

// The work offset this report proves: its own WCO: field, the difference of
// its MPos and WPos, or the shift KerfDesk recorded for a controller that
// reports only the work position.
function reportedWorkOffset(state: LaserState, report: StatusReport): WorkCoordinateOffset | null {
  return report.wco ?? sameFrameWorkOffset(report) ?? hostRecordedWorkOffset(state, report);
}

// A controller that reports only its work position (Marlin) gets its machine
// position from the recorded shift, so consumers that read MPos (the DRO, Print
// and Cut, Job Review) see the machine frame (host-recorded-origin.ts).
function withHostRecordedMachinePosition(
  state: LaserState,
  report: StatusReport,
  offset: WorkCoordinateOffset,
): StatusReport {
  if (state.capabilities.workOffsetSource !== 'host-recorded') return report;
  if (report.mPos !== null || report.wPos === null) return report;
  const sum = (a: number, b: number): number => Math.round((a + b) * 10_000) / 10_000;
  return {
    ...report,
    mPos: {
      x: sum(report.wPos.x, offset.x),
      y: sum(report.wPos.y, offset.y),
      z: sum(report.wPos.z, offset.z),
    },
  };
}

// Smoothieware reports MPos and WPos from one sample and never a WCO: field, so
// the work offset is MPos - WPos: the same quantity GRBL's WCO: carries (WCS
// offset, G92 and tool offset; Smoothieware Kernel.cpp:207-234 and 262-288,
// Robot.cpp:448-456 mcs2wcs at 38e2cc08). Taking it from the report re-learns a
// G92 the board keeps through a reconnect, halt, M999 or Home, which KerfDesk
// had forgotten (controller audit 2026-09-25 SM-1, CG-1). GRBL-family
// controllers report MPos or WPos, never both. Rounded to the reports' own
// 4-decimal resolution so float noise cannot change the cached value.
function sameFrameWorkOffset(report: StatusReport): WorkCoordinateOffset | null {
  if (report.mPos === null || report.wPos === null) return null;
  const difference = (a: number, b: number): number => Math.round((a - b) * 10_000) / 10_000;
  return {
    x: difference(report.mPos.x, report.wPos.x),
    y: difference(report.mPos.y, report.wPos.y),
    z: difference(report.mPos.z, report.wPos.z),
  };
}

function hasActiveXyOrigin(state: LaserState, wco: WorkCoordinateOffset): boolean {
  const [x, y, z] = normalizeReportedMPosToMm(
    [wco.x, wco.y, wco.z],
    state.controllerSettings?.reportInches === true,
  );
  const deliberateOrigin =
    state.workOriginSource === 'g92' || state.workOriginSource === 'g54-persistent';
  return hasCustomXyOrigin({ x, y, z }) || deliberateOrigin;
}

// The caches keep their identity while the controller repeats the same values.
// Every consumer selects them by reference, so a fresh-but-equal object from
// each Ov:/A:/WCO frame re-rendered those consumers on polls that changed
// nothing. The shallow comparison is exact only for flat scalar values, which
// FlatCache enforces: a nested field added later fails to compile here rather
// than silently comparing by reference.
type FlatCache = Readonly<Record<string, number | boolean | string | null | undefined>>;

function unchangedOr<T extends FlatCache>(previous: T | null | undefined, next: T): T {
  if (previous === null || previous === undefined) return next;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return next;
  return keys.every((key) => Object.is(previous[key], next[key])) ? previous : next;
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
