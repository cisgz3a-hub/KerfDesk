// Relief3DViewerDialog — the ADR-102 3D relief viewer. Rebuilds the
// heightmap at display resolution, converts it to plain mesh arrays in pure
// core, and hands them to the lazy three.js scene module through the shared
// dialog shell. Environments without WebGL get a plain-text fallback (what
// jsdom tests assert).

import { useCallback, useMemo } from 'react';
import { heightmapCellSize, type Heightmap } from '../../core/relief';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import type { ReliefObject } from '../../core/scene';
import {
  prepareCncCut3DSurfaceOffThread,
  prepareReliefHeightmapOffThread,
} from '../workspace/cnc-removal-grid-worker-client';
import { createReliefThreeScene } from './relief-three-scene';
import {
  relief3dDisplayResolutionNotice,
  type Relief3DDisplayResolution,
} from './relief3d-display-resolution';
import {
  relief3dViewerDialogPlan,
  type Relief3DViewerDialogPlan,
} from './Relief3DViewerDialog/relief-3d-viewer-dialog-plan';
import { Viewer3DDialogShell } from './Viewer3DDialogShell';

export function Relief3DViewerDialog(props: {
  readonly relief: ReliefObject;
  readonly stockThicknessMm: number;
  readonly onClose: () => void;
}): JSX.Element {
  const { relief, stockThicknessMm } = props;
  const plan = useMemo(() => relief3dViewerDialogPlan(relief), [relief]);
  const resolutionNotice = relief3dDisplayResolutionNotice(plan.resolution);
  const buildScene = useCallback(
    (canvas: HTMLCanvasElement, signal: AbortSignal) =>
      buildReliefScene(canvas, relief, stockThicknessMm, plan, signal),
    [relief, plan, stockThicknessMm],
  );
  return (
    <Viewer3DDialogShell
      ariaLabel="Relief 3D viewer"
      canvasAriaLabel="Relief 3D preview"
      title={plan.title}
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
  plan: Relief3DViewerDialogPlan,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof createReliefThreeScene>>> {
  try {
    const displayCellSize = heightmapCellSize(
      plan.machineSpace.widthMm,
      plan.machineSpace.heightMm,
      plan.resolution.effectiveMmPerCell,
    );
    if (displayCellSize.kind === 'error') {
      return { kind: 'no-webgl', reason: displayCellSize.reason };
    }
    const options = {
      targetWidthMm: plan.planningWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      targetScaleX: plan.machineSpace.targetScaleX,
      targetScaleY: plan.machineSpace.targetScaleY,
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
      removalGridFrom(heightmap.heightmap, plan.resolution),
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
