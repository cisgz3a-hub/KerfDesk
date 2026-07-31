// DesignViewport3D — the Studio's canvas, as a 3D design space (ADR-272
// Amendment 2). The stock sits on a grid, the sketch draws on its top face,
// the carve deepens live underneath, and the camera orbits freely — drawing
// runs through the SAME gesture machine as the flat canvas via the surface
// adapter, so precision behavior cannot drift between the two.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { steppedSurfaceMesh } from '../../../core/heightfield';
import type { ViewerContentInput } from '../../cnc-viewer3d/viewer3d-content';
import { buildViewportOverlay } from './viewport-overlay';
import { createFrameScheduler, frameSchedulerHostFor } from '../design-frame-scheduler';
import type { DesignSurface } from '../design-surface';
import { useDesignStudioStore } from '../design-studio-store';
import { useDesignPointer } from '../use-design-pointer';
import { ShapeInspector } from '../ShapeInspector';
import { useDesignCarveContent } from '../preview3d/use-design-carve-content';
import { useDesignSimulate } from '../preview3d/use-design-simulate';
import { DesignViewportToolbar } from './DesignViewportToolbar';
import { useDesignViewportScene } from './use-design-viewport-scene';
import type { ViewportFrame } from './viewport-scene';

export function DesignViewport3D(): JSX.Element {
  const carve = useDesignCarveContent();
  const frame = useViewportFrame(carve);
  const tiers = useCarveTiers(carve);
  const scene = useDesignViewportScene(frame, tiers.activeContent);
  const surface = useViewportSurface(scene);
  const pointer = useDesignPointer(surface, () => crypto.randomUUID());
  useOverlaySync(scene, frame);

  return (
    <div style={hostStyle}>
      <canvas
        ref={scene.canvasRef}
        aria-label="3D design space — draw with the left button, pan with middle, orbit with right or Shift+middle, zoom with the wheel"
        style={canvasStyle}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerLeave={pointer.onPointerLeave}
      />
      <DesignViewportToolbar
        tier={tiers.shownTier}
        canShowBits={tiers.canShowBits}
        isStale={tiers.isStale}
        failReason={tiers.failReason}
        onPreset={(preset) => scene.handleRef.current?.setPreset(preset)}
        onTier={tiers.setTier}
        onSimulate={tiers.simulateNow}
      />
      {scene.state === 'ready' ? null : (
        <p style={stateStyle}>
          {scene.state === 'loading'
            ? 'Building the design space…'
            : '3D needs WebGL — switch to 2D in the top bar; drawing and Apply work the same there.'}
        </p>
      )}
      <ShapeInspector />
    </div>
  );
}

function useViewportFrame(carve: ReturnType<typeof useDesignCarveContent>): ViewportFrame {
  return useMemo<ViewportFrame>(
    () => ({
      originMm: { x: carve?.source.stock.originX ?? 0, y: carve?.source.stock.originY ?? 0 },
      widthMm: carve?.source.stock.widthMm ?? 100,
      heightMm: carve?.source.stock.heightMm ?? 100,
      thicknessMm: carve?.source.stock.thicknessMm ?? 6,
    }),
    [carve?.source],
  );
}

// One writer decides what the scene carves: the Bits tier when a simulation
// exists and is selected, the live design surface otherwise. A sketch edit
// while on Bits keeps showing the (stale-labelled) simulation until the
// operator re-runs or switches — honest, and free of content races.
function useCarveTiers(carve: ReturnType<typeof useDesignCarveContent>): {
  readonly activeContent: ViewerContentInput | null;
  readonly shownTier: 'design' | 'bits';
  readonly canShowBits: boolean;
  readonly isStale: boolean;
  readonly failReason: string | null;
  readonly setTier: (tier: 'design' | 'bits') => void;
  readonly simulateNow: () => void;
} {
  const sim = useDesignSimulate(carve?.source ?? null);
  const [tier, setTier] = useState<'design' | 'bits'>('design');
  const simContent = useMemo<ViewerContentInput | null>(() => {
    if (sim.simulate.kind !== 'ok' || carve === null) return null;
    return {
      mesh: steppedSurfaceMesh(sim.simulate.grid),
      stockThicknessMm: carve.source.stock.thicknessMm,
      ...(carve.source.materialKey === undefined ? {} : { materialKey: carve.source.materialKey }),
    };
  }, [sim.simulate, carve]);
  const showingBits = tier === 'bits' && simContent !== null;
  const simulateNow = useCallback(() => {
    sim.run();
    setTier('bits');
  }, [sim]);
  return {
    activeContent: showingBits ? simContent : (carve?.content ?? null),
    shownTier: showingBits ? 'bits' : 'design',
    canShowBits: simContent !== null,
    isStale: sim.isStale,
    failReason:
      sim.simulate.kind === 'failed' || sim.simulate.kind === 'empty' ? sim.simulate.reason : null,
    setTier,
    simulateNow,
  };
}

// The pointer mapping the shared gesture machine needs: plane raycast for the
// position, projected pixels-per-mm for hit radii.
function useViewportSurface(scene: ReturnType<typeof useDesignViewportScene>): DesignSurface {
  return useMemo<DesignSurface>(
    () => ({
      toMm: (event) => {
        const handle = scene.handleRef.current;
        const rect = scene.canvasRef.current?.getBoundingClientRect();
        if (handle === null || rect === undefined) return null;
        return handle.pointerToSceneMm(event.clientX - rect.left, event.clientY - rect.top);
      },
      pxPerMm: () => scene.handleRef.current?.pxPerMmAtTarget() ?? 1,
    }),
    [scene.handleRef, scene.canvasRef],
  );
}

// The sketch overlay repaints on store changes, coalesced to one frame — the
// exact scheduler discipline the 2D canvas uses, driving updateOverlay
// instead of a 2D painter.
function useOverlaySync(
  scene: ReturnType<typeof useDesignViewportScene>,
  frame: ViewportFrame,
): void {
  useEffect(() => {
    const paint = (): void => {
      const session = useDesignStudioStore.getState().session;
      const handle = scene.handleRef.current;
      if (session === null || handle === null) return;
      handle.updateOverlay(
        buildViewportOverlay({
          sketch: session.history.present,
          selectedIds: session.selectedIds,
          draft: session.draft,
          snapMm: session.activeSnap?.atMm ?? null,
          frame,
        }),
      );
    };
    const scheduler = createFrameScheduler(paint, frameSchedulerHostFor(window));
    const unsubscribe = useDesignStudioStore.subscribe(scheduler.request);
    scheduler.flush();
    return () => {
      unsubscribe();
      scheduler.cancel();
    };
  }, [scene, frame]);

  // The first overlay after the scene finishes building would otherwise wait
  // for the next store change.
  useEffect(() => {
    if (scene.state !== 'ready') return;
    const session = useDesignStudioStore.getState().session;
    const handle = scene.handleRef.current;
    if (session === null || handle === null) return;
    handle.updateOverlay(
      buildViewportOverlay({
        sketch: session.history.present,
        selectedIds: session.selectedIds,
        draft: session.draft,
        snapMm: session.activeSnap?.atMm ?? null,
        frame,
      }),
    );
  }, [scene, scene.state, frame]);
}

const hostStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
};

const canvasStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  touchAction: 'none',
};

const stateStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  margin: 0,
  padding: 16,
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--lf-text-dim)',
  pointerEvents: 'none',
};
