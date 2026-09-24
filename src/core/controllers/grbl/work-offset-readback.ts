import { parseCanonicalStatusNumber } from './status-parser';

export type ActiveWorkCoordinateSystem = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';

export type OwnedWorkOffsetReadback =
  | {
      readonly ok: true;
      readonly activeWcs: ActiveWorkCoordinateSystem;
      readonly offset: { readonly x: number; readonly y: number; readonly z: number };
    }
  | { readonly ok: false; readonly reason: string };

const MODAL_REPORT_RE = /^\[GC:([^\]]*)\]$/;
const ACTIVE_WCS_RE = /^G5[4-9]$/;

export function parseOwnedWorkOffsetReadback(
  modalResponses: ReadonlyArray<string>,
  offsetResponses: ReadonlyArray<string>,
): OwnedWorkOffsetReadback {
  const modalBodies = matchingBodies(modalResponses, MODAL_REPORT_RE);
  if (modalBodies.length !== 1) {
    return { ok: false, reason: 'Expected exactly one GC modal report from the owned $G query.' };
  }
  const activeWcs = activeWcsFromModal(modalBodies[0] ?? '');
  if (activeWcs === null) {
    return {
      ok: false,
      reason: 'The owned modal report did not identify exactly one active G54-G59 WCS.',
    };
  }
  const offsetBodies = matchingBodies(
    offsetResponses,
    new RegExp(`^\\[${activeWcs}:([^\\]]*)\\]$`),
  );
  if (offsetBodies.length !== 1) {
    return {
      ok: false,
      reason: `Expected exactly one ${activeWcs} offset report from the owned $# query.`,
    };
  }
  const offset = parseOffset(offsetBodies[0] ?? '');
  return offset === null
    ? { ok: false, reason: `${activeWcs} must report at least three finite coordinates.` }
    : { ok: true, activeWcs, offset };
}

// The active WCS alone from an owned `$G` modal report, without also requiring
// the `$#` offset readback. Used at connect to seed store.activeWcs so a
// non-G54 WCS left active by a $N startup block or an external session is
// visible to the placement-mismatch advisory (C6). Null when the response is
// not exactly one GC report naming exactly one G54-G59 word.
export function parseActiveWcsFromModalResponses(
  modalResponses: ReadonlyArray<string>,
): ActiveWorkCoordinateSystem | null {
  const modalBodies = matchingBodies(modalResponses, MODAL_REPORT_RE);
  return modalBodies.length === 1 ? activeWcsFromModal(modalBodies[0] ?? '') : null;
}

function matchingBodies(lines: ReadonlyArray<string>, pattern: RegExp): string[] {
  return lines.flatMap((line) => {
    const match = pattern.exec(line.trim());
    return match === null ? [] : [match[1] ?? ''];
  });
}

function activeWcsFromModal(body: string): ActiveWorkCoordinateSystem | null {
  const matches = body
    .split(/\s+/)
    .filter((word): word is ActiveWorkCoordinateSystem => ACTIVE_WCS_RE.test(word));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

// `$#` prints one value per configured axis: exactly XYZ on GRBL 1.1, but
// grblHAL and FluidNC loop over every axis (system_n_axis() / _numberAxis),
// so a rotary build reports `[G54:x,y,z,a]`. XYZ are the first three either
// way, as in the status parser's MPos/WPos/WCO fields. A grblHAL build with
// ROTATION_ENABLE appends `:<degrees>` for G54-G59; that rotation is about Z,
// so it never changes the Z offset.
// https://github.com/grblHAL/core/blob/master/report.c (report_ngc_parameters)
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Report.cpp (report_ngc_coord)
function parseOffset(
  body: string,
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const [axes = '', rotation, ...extra] = body.split(':');
  if (extra.length > 0) return null;
  if (rotation !== undefined && parseCanonicalStatusNumber(rotation) === null) return null;
  // Every token must be a real number: Number('') is 0, so `1,2,` must not read as z=0.
  const values = axes.split(',').map(parseCanonicalStatusNumber);
  if (values.length < 3 || values.includes(null)) return null;
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
}
