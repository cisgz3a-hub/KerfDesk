// Relief3DViewerDialog — the ADR-102 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module through the shared
// dialog shell. Environments without WebGL get a plain-text fallback (what
// jsdom tests assert).

import { useCallback } from 'react';
import { heightmapCellSize, type Heightmap } from '../../core/relief';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
// Deep import: core/relief's public barrel is a ratcheted over-cap legacy
// barrel and may only shrink; keep the established exports intact.
import { reliefPhysicalDimensions } from '../../core/relief/relief-physical-dimensions';
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
  const dimensions = reliefPhysicalDimensions(relief);
  const buildScene = useCallback(
    (canvas: HTMLCanvasElement, signal: AbortSignal) =>
      buildReliefScene(canvas, relief, stockThicknessMm, signal),
    [relief, stockThicknessMm],
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Relief 3D viewer"
      canvasAriaLabel="Relief 3D preview"
      title={`${relief.source} — ${formatMm(dimensions.widthMm)} mm wide × ${formatMm(relief.reliefDepthMm)} mm deep`}
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
    const dimensions = reliefPhysicalDimensions(relief);
    const mmPerCell = Math.max(
      MIN_DISPLAY_CELL_MM,
      Math.max(dimensions.widthMm, dimensions.heightMm) / DISPLAY_CELLS_ACROSS,
    );
    const displayCellSize = heightmapCellSize(dimensions.widthMm, dimensions.heightMm, mmPerCell);
    if (displayCellSize.kind === 'error') {
      return { kind: 'no-webgl', reason: displayCellSize.reason };
    }
    const options = {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      targetScaleX: dimensions.targetScaleX,
      targetScaleY: dimensions.targetScaleY,
      mmPerCell: displayCellSize.mmPerCell,
    };
    const offThread =
      relief.reliefSource.kind === 'legacy-mesh'
        ? null
        : prepareReliefHeightmapOffThread(relief.reliefSource, options, signal);
    if (relief.reliefSource.kind === 'heightfield-v1' && offThread === null) {
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
  return {
    ...map,
    originX: 0,
    originY: 0,
    resolution: {
      requestedMmPerCell: map.mmPerCell,
      effectiveMmPerCell: map.mmPerCell,
      reason: null,
    },
  };
}

function formatMm(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
