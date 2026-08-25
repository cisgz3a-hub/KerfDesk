// Relief3DViewerDialog — the ADR-102 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module through the shared
// dialog shell. Environments without WebGL get a plain-text fallback (what
// jsdom tests assert).

import { useCallback, useMemo } from 'react';
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
import {
  relief3dDisplayResolution,
  relief3dDisplayResolutionNotice,
  type Relief3DDisplayResolution,
} from './relief3d-display-resolution';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

export function Relief3DViewerDialog(props: {
  readonly relief: ReliefObject;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { relief, stockThicknessMm } = props;
  const dimensions = reliefPhysicalDimensions(relief);
  const resolution = useMemo(
    () => relief3dDisplayResolution(dimensions.widthMm, dimensions.heightMm),
    [dimensions.heightMm, dimensions.widthMm],
  );
  const resolutionNotice = relief3dDisplayResolutionNotice(resolution);
  const buildScene = useCallback(
    (canvas: HTMLCanvasElement, signal: AbortSignal) =>
      buildReliefScene(canvas, relief, stockThicknessMm, resolution, signal),
    [relief, resolution, stockThicknessMm],
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Relief 3D viewer"
      canvasAriaLabel="Relief 3D preview"
      title={`${relief.source} — ${formatMm(dimensions.widthMm)} mm wide × ${formatMm(relief.reliefDepthMm)} mm deep`}
      {...(resolutionNotice === undefined ? {} : { notice: resolutionNotice })}
      onClose={props.onClose}
      buildScene={buildScene}
    />
  );
}

async function buildReliefScene(
  canvas: HTMLCanvasElement,
  relief: ReliefObject,
  stockThicknessMm: number,
  resolution: Relief3DDisplayResolution,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof createReliefThreeScene>>> {
  try {
    const dimensions = reliefPhysicalDimensions(relief);
    const displayCellSize = heightmapCellSize(
      dimensions.widthMm,
      dimensions.heightMm,
      resolution.effectiveMmPerCell,
    );
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
      removalGridFrom(heightmap.heightmap, resolution),
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

function removalGridFrom(map: Heightmap, resolution: Relief3DDisplayResolution) {
  return {
    ...map,
    originX: 0,
    originY: 0,
    resolution,
  };
}

function formatMm(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}
