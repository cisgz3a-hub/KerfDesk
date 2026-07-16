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
    ? { ok: false, reason: `${activeWcs} must report exactly three finite coordinates.` }
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

function parseOffset(
  body: string,
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const values = body.split(',').map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return null;
  return { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 };
}
