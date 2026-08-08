// Relief3DViewerDialog — the ADR-102 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module through the shared
// dialog shell. Environments without WebGL get a plain-text fallback (what
// jsdom tests assert).

import { useCallback } from 'react';
import { heightmapCellSize, type Heightmap } from '../../core/relief';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import type { ReliefObject } from '../../core/scene';
import {
  prepareCncCut3DSurfaceOffThread,
  prepareReliefHeightmapOffThread,
} from '../workspace/cnc-removal-grid-worker-client';
import { createReliefThreeScene } from './relief-three-scene';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

// ~256 cells across keeps the display mesh under ~130k triangles.
const DISPLAY_CELLS_ACROSS = 256;
const MIN_DISPLAY_CELL_MM = 0.25;

export function Relief3DViewerDialog(props: {
  readonly relief: ReliefObject;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { relief, stockThicknessMm } = props;
  const buildScene = useCallback(
    (canvas: HTMLCanvasElement, signal: AbortSignal) =>
      buildReliefScene(canvas, relief, stockThicknessMm, signal),
    [relief, stockThicknessMm],
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Relief 3D viewer"
      canvasAriaLabel="Relief 3D preview"
      title={`${relief.source} — ${relief.targetWidthMm.toFixed(0)} mm wide × ${relief.reliefDepthMm.toFixed(1)} mm deep`}
      onClose={props.onClose}
      buildScene={buildScene}
    />
  );
}

async function buildReliefScene(
  canvas: HTMLCanvasElement,
  relief: ReliefObject,
  stockThicknessMm: number,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof createReliefThreeScene>>> {
  try {
    const targetHeightMm = reliefTargetHeightMm(relief);
    const mmPerCell = Math.max(
      MIN_DISPLAY_CELL_MM,
      Math.max(relief.targetWidthMm, targetHeightMm) / DISPLAY_CELLS_ACROSS,
    );
    const displayCellSize = heightmapCellSize(relief.targetWidthMm, targetHeightMm, mmPerCell);
    if (displayCellSize.kind === 'error') {
      return { kind: 'no-webgl', reason: displayCellSize.reason };
    }
    const options = {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      mmPerCell: displayCellSize.mmPerCell,
    };
    const offThread =
      relief.depthMap === undefined
        ? null
        : prepareReliefHeightmapOffThread(relief.depthMap, options, signal);
    if (relief.depthMap !== undefined && offThread === null) {
      return { kind: 'no-webgl', reason: 'Relief preview worker is unavailable.' };
    }
    const heightmap =
      offThread === null ? reliefObjectToHeightmap(relief, options) : await offThread;
    if (heightmap.kind === 'error') return { kind: 'no-webgl', reason: heightmap.reason };
    if (signal.aborted) return { kind: 'no-webgl', reason: 'Relief preview was cancelled.' };
    const surfaceWork = prepareCncCut3DSurfaceOffThread(
      removalGridFrom(heightmap.heightmap),
      signal,
    );
    if (surfaceWork === null) {
      return { kind: 'no-webgl', reason: 'Relief surface worker is unavailable.' };
    }
    const surface = await surfaceWork;
    if (signal.aborted) return { kind: 'no-webgl', reason: 'Relief preview was cancelled.' };
    return await createReliefThreeScene(canvas, surface, stockThicknessMm);
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'The 3D renderer failed to start.',
    };
  }
}

function removalGridFrom(map: Heightmap) {
  return { ...map, originX: 0, originY: 0 };
}

function reliefTargetHeightMm(relief: ReliefObject): number {
  if (relief.depthMap !== undefined) {
    return relief.targetWidthMm * (relief.depthMap.height / relief.depthMap.width);
  }
  const sourceWidth = relief.bounds.maxX - relief.bounds.minX;
  const sourceHeight = relief.bounds.maxY - relief.bounds.minY;
  return sourceWidth > 0 && sourceHeight > 0
    ? relief.targetWidthMm * (sourceHeight / sourceWidth)
    : relief.targetWidthMm;
}
