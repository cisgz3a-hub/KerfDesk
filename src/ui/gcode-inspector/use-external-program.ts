// use-external-program — the Run dialog's inputs that change over time
// (ADR-630): the normalized program, made a slice at a time so a large file
// never holds the page, and where the head stands, which the program is read
// from.

import { useEffect, useMemo, useState } from 'react';
import type { ControllerKind } from '../../core/devices';
import {
  createExternalProgramNormalizer,
  externalProgramBaseline,
  sourceLines,
  type ExternalProgramResult,
} from '../../core/external-program';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { useLaserStore, type LaserState } from '../state/laser-store';

export type RunStart = { readonly x: number; readonly y: number; readonly z: number };

/** Lines normalized between yields to the page. */
const LINES_PER_SLICE = 20_000;

/** Normalizes `text` a slice of lines at a time. Null when `live()` turns
 * false first (the dialog closed, or another file arrived). */
export async function normalizeInSlices(
  text: string,
  live: () => boolean,
  baseline?: string,
  controllerKind?: ControllerKind,
): Promise<ExternalProgramResult | null> {
  const normalizer = createExternalProgramNormalizer(baseline, controllerKind);
  let count = 0;
  for (const line of sourceLines(text)) {
    normalizer.push(line);
    count += 1;
    if (count % LINES_PER_SLICE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!live()) return null;
    }
  }
  return normalizer.finish();
}

/** The normalized program, or null while it is being made. Its baseline
 * line is the one the active controller accepts (externalProgramBaseline). */
export function useNormalizedProgram(text: string): ExternalProgramResult | null {
  const controllerKind = useLaserStore((state) => state.activeControllerKind);
  const baseline = externalProgramBaseline(controllerKind);
  const [result, setResult] = useState<{
    readonly text: string;
    readonly baseline: string;
    readonly controllerKind: ControllerKind;
    readonly value: ExternalProgramResult;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void normalizeInSlices(text, () => live, baseline, controllerKind).then((value) => {
      if (live && value !== null) setResult({ text, baseline, controllerKind, value });
    });
    return () => {
      live = false;
    };
  }, [text, baseline, controllerKind]);
  return result?.text === text &&
    result.baseline === baseline &&
    result.controllerKind === controllerKind
    ? result.value
    : null;
}

// A thousandth of a millimetre, the reports' own resolution, so report noise
// never re-reads the program.
function startKey(laser: LaserState): string | null {
  if (laser.connection.kind !== 'connected' || laser.statusReport?.state !== 'Idle') return null;
  const here = reportedWorkPositionMm(laser, laser.controllerSettings?.reportInches === true);
  if (here === null) return null;
  return [here.x, here.y, here.z].map((value) => value.toFixed(3)).join(',');
}

/** Where an Idle, connected head stands in work coordinates; null otherwise. */
export function useLiveRunStart(): RunStart | null {
  const key = useLaserStore(startKey);
  return useMemo(() => {
    if (key === null) return null;
    const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
    return { x, y, z };
  }, [key]);
}
