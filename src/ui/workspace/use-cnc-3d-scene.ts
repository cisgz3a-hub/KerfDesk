// useCnc3dScene — owns the CNC pane's three.js scene lifecycle.
//
// Split out of Cnc3DPane so the component stays a component. The rule this
// hook exists to enforce: the scene is created ONCE and updated in place. Its
// teardown deliberately lives in a separate zero-dependency effect so it runs
// at unmount only — sharing an effect with the update path is exactly what
// used to dispose the renderer on every edit and snap the operator's orbit
// back to the default view.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChiploadMaterial } from '../../core/cnc';
import { steppedSurfaceMesh } from '../../core/heightfield';
import { downsampleRemovalGrid, type RemovalGrid, type ToolProfilePoint } from '../../core/sim';
import { pointAtArcLength, type Move3d } from '../../core/toolpath3d';
import type { Viewer3DDisplayMode } from '../viewer3d/viewer3d-display-mode';
import {
  createReliefThreeScene,
  type ReliefSceneHandle,
} from '../relief-viewer/relief-three-scene';

// Display resolution for the pane's surface mesh. The stepped builder emits
// several times the vertex count of a smooth grid, so the downsample matters.
const PANE_DISPLAY_CELLS_ACROSS = 300;

export type Cnc3dSceneState = 'loading' | 'ready' | 'failed';

// One simulation feeding two drawables: the carved surface and the path that
// carved it. Both are in scene frame (ADR-254 §2).
export type DesignSceneSource = {
  readonly grid: RemovalGrid;
  // The job's stock material, so the carve is shaded as the stock the operator
  // actually loaded rather than as generic timber.
  readonly materialKey?: ChiploadMaterial;
  readonly moves: ReadonlyArray<Move3d>;
  readonly toolProfile: ReadonlyArray<ToolProfilePoint>;
};

export type Cnc3dScene = {
  // MutableRefObject, not RefObject: React 18 types RefObject<T> with a
  // readonly current, and a nullable T makes it unassignable to the JSX ref
  // prop. useRef's own return type is what the consumer needs.
  readonly canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  readonly state: Cnc3dSceneState;
  // View controls that act on the live scene without rebuilding it. Null-safe:
  // they no-op until the scene finishes loading, so a toolbar can be rendered
  // immediately rather than waiting on the WebGL context.
  readonly controls: Cnc3dSceneControls;
};

export type Cnc3dSceneControls = {
  readonly setDisplayMode: (mode: Viewer3DDisplayMode) => void;
  readonly setSectionFraction: (fraction: number) => void;
  readonly capturePng: (scale: number) => string | null;
};

/**
 * Creates and maintains the pane's 3D scene for a design source.
 *
 * @param source Removal grid, 3D moves and tool profile, or null when there is
 *   nothing to show.
 * @param stockThicknessMm Stock thickness in mm.
 * @returns The canvas ref to mount and the scene's load state.
 */
export function useCnc3dScene(
  source: DesignSceneSource | null,
  stockThicknessMm: number,
  scrubberT: number,
): Cnc3dScene {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ReliefSceneHandle | null>(null);
  const [state, setState] = useState<Cnc3dSceneState>('loading');

  // Zero deps: runs at unmount only. See the module header.
  useEffect(() => {
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || source === null) return;
    let cancelled = false;
    const content = contentFor(source, stockThicknessMm);

    const existing = handleRef.current;
    if (existing !== null) {
      void existing.updateContent(content).catch(() => {
        if (!cancelled) setState('failed');
      });
      return;
    }

    setState('loading');
    void createReliefThreeScene(canvas, content.mesh, stockThicknessMm, content.toolpath)
      .then((outcome) => {
        if (cancelled) {
          if (outcome.kind === 'ok') outcome.handle.dispose();
          return;
        }
        if (outcome.kind !== 'ok') {
          setState('failed');
          return;
        }
        handleRef.current = outcome.handle;
        // The pane is resizable, so fit the freshly-built scene to the
        // canvas's actual laid-out size rather than its mount-time attrs.
        outcome.handle.resize(canvas.clientWidth, canvas.clientHeight);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [source, stockThicknessMm]);

  // Scrubbing is its own effect on purpose. Folding it into the content effect
  // above re-stamped the whole surface on every tick of the slider, which is
  // exactly the per-keystroke rebuild this hook was written to eliminate.
  useEffect(() => {
    const totalMm = totalLengthMm(source);
    handleRef.current?.setScrubMm(scrubberT >= 1 || totalMm <= 0 ? null : scrubberT * totalMm);
  }, [source, scrubberT, state]);

  // Keep the renderer buffer in step with the resizable pane so the 3D view
  // stays crisp at any width (the scene renders on demand, not on a rAF loop).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      handleRef.current?.resize(canvas.clientWidth, canvas.clientHeight);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const controls = useMemo<Cnc3dSceneControls>(
    () => ({
      setDisplayMode: (mode) => handleRef.current?.setDisplayMode(mode),
      setSectionFraction: (fraction) => handleRef.current?.setSectionFraction(fraction),
      capturePng: (scale) => handleRef.current?.capturePng(scale) ?? null,
    }),
    [],
  );

  return { canvasRef, state, controls };
}

// Total declared program length. Read from the last move rather than summed,
// because startMm already accumulates every preceding step's declared length.
function totalLengthMm(source: DesignSceneSource | null): number {
  const last = source?.moves[source.moves.length - 1];
  return last === undefined ? 0 : last.startMm + last.lengthMm;
}

function contentFor(
  source: DesignSceneSource,
  stockThicknessMm: number,
): Parameters<ReliefSceneHandle['updateContent']>[0] {
  const { grid, moves, toolProfile, materialKey } = source;
  const display = downsampleRemovalGrid(grid, PANE_DISPLAY_CELLS_ACROSS);
  // Initial cutter placement only; the scrub effect repositions it from there
  // without rebuilding anything.
  const toolAt = pointAtArcLength(moves, Number.POSITIVE_INFINITY);
  return {
    mesh: steppedSurfaceMesh(display),
    stockThicknessMm,
    ...(materialKey === undefined ? {} : { materialKey }),
    // Downsampling keeps the grid's min corner, so the full-resolution origin
    // is still the right offset for the path.
    toolpath: {
      moves,
      originMm: { x: grid.originX, y: grid.originY },
      toolProfile,
      ...(toolAt === null ? {} : { toolAtMm: toolAt }),
    },
  };
}
