import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type LayerMode, type FillMode } from '../../core/scene/Layer';
import { applyLayerModeChange } from '../../core/scene/layerModeTransition';
import { MAX_LASER_SPEED, MIN_LASER_SPEED } from '../../core/types';

export interface ConnectionPanelGrbl {
  isJobRunning: boolean;
}

export interface UseConnectionHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
  compileGcode: (targetScene: Scene) => Promise<string | null>;
  setCurrentGcode: Dispatch<SetStateAction<string | null>>;
  connectionSidebarOpen: boolean;
  gcodeStale: boolean;
  setGcodeStale: Dispatch<SetStateAction<boolean>>;
  grbl: ConnectionPanelGrbl;
}

export interface ConnectionHandlers {
  handleConnectionRecompile: () => void;
  handleConnectionUpdateLayerMode: (layerId: string, mode: LayerMode) => void;
  handleConnectionUpdateLayerSetting: (
    layerId: string,
    key: 'powerMax' | 'speed' | 'passes',
    value: number,
  ) => void;
  handleConnectionUpdateLayerFillMode: (layerId: string, fillMode: FillMode) => void;
  handleConnectionUpdateLayerFillInterval: (layerId: string, intervalMm: number) => void;
  handleConnectionUpdateLayerFillBidirectional: (layerId: string, bidirectional: boolean) => void;
}

export function useConnectionHandlers(params: UseConnectionHandlersParams): ConnectionHandlers {
  const {
    scene,
    handleSceneCommit,
    compileGcode,
    setCurrentGcode,
    connectionSidebarOpen,
    gcodeStale,
    setGcodeStale,
    grbl,
  } = params;

  const isJobRunningRef = useRef(grbl.isJobRunning);
  isJobRunningRef.current = grbl.isJobRunning;

  const handleConnectionRecompile = useCallback(() => {
    void (async () => {
      const gc = await compileGcode(scene);
      setCurrentGcode(gc);
    })();
  }, [scene, compileGcode, setCurrentGcode]);

  // Auto-recompile G-code when the design changes (debounced).
  // Replaces the manual "↻ Update" step in the connection panel.
  useEffect(() => {
    if (!connectionSidebarOpen) return;
    if (grbl.isJobRunning) return;
    if (!gcodeStale) return;

    const timer = setTimeout(() => {
      // Re-check at fire time — job may have started between scheduling and firing.
      // The effect-level guard only covers scheduling time.
      if (isJobRunningRef.current) return;
      handleConnectionRecompile();
    }, 500);

    return () => clearTimeout(timer);
  }, [gcodeStale, connectionSidebarOpen, grbl.isJobRunning, handleConnectionRecompile]);

  const bumpCanvasRepaint = useCallback(() => {
    try {
      window.dispatchEvent(new Event('laserforge-canvas-repaint'));
    } catch { /* ignore */ }
  }, []);

  /** Connection sidebar edits arbitrary layers; LayerPanel’s mode UI is for `activeLayerId` only — align selection here. */
  const handleConnectionUpdateLayerMode = useCallback(
    (layerId: string, mode: LayerMode) => {
      const layer = scene.layers.find(l => l.id === layerId);
      if (!layer) return;
      let next = applyLayerModeChange(layer, mode);
      // Auto-rename if the name matches the old mode (e.g. "Cut" → "Engrave")
      const modeNames: Record<LayerMode, string> = { cut: 'Cut', engrave: 'Engrave', score: 'Score', image: 'Image' };
      if (layer.name.toLowerCase() === layer.settings.mode) {
        next = { ...next, name: modeNames[mode] };
      }
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => (l.id === layerId ? next : l)),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerSetting = useCallback(
    (layerId: string, key: 'powerMax' | 'speed' | 'passes', value: number) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          if (key === 'powerMax') {
            const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
            return { ...l, settings: { ...l.settings, power: { ...l.settings.power, max: v } } };
          }
          if (key === 'speed') {
            const v = Math.max(MIN_LASER_SPEED, Math.min(MAX_LASER_SPEED, Math.round(Number.isFinite(value) ? value : 1000)));
            return { ...l, settings: { ...l.settings, speed: v } };
          }
          const v = Math.max(1, Math.min(99, Math.round(Number.isFinite(value) ? value : 1)));
          return { ...l, settings: { ...l.settings, passes: v } };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillMode = useCallback(
    (layerId: string, fillMode: FillMode) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          const interval = Number(f.interval) > 0 ? f.interval : 0.1;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                enabled: true,
                mode: fillMode,
                interval,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillInterval = useCallback(
    (layerId: string, intervalMm: number) => {
      const interval = Math.max(0.02, Math.min(1, Number.isFinite(intervalMm) ? intervalMm : 0.1));
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                enabled: true,
                interval,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  const handleConnectionUpdateLayerFillBidirectional = useCallback(
    (layerId: string, bidirectional: boolean) => {
      handleSceneCommit({
        ...scene,
        activeLayerId: layerId,
        layers: scene.layers.map(l => {
          if (l.id !== layerId) return l;
          const f = l.settings.fill;
          return {
            ...l,
            settings: {
              ...l.settings,
              fill: {
                ...f,
                biDirectional: bidirectional,
              },
            },
          };
        }),
      });
      if (connectionSidebarOpen) setGcodeStale(true);
      bumpCanvasRepaint();
    },
    [scene, handleSceneCommit, connectionSidebarOpen, bumpCanvasRepaint],
  );

  return {
    handleConnectionRecompile,
    handleConnectionUpdateLayerMode,
    handleConnectionUpdateLayerSetting,
    handleConnectionUpdateLayerFillMode,
    handleConnectionUpdateLayerFillInterval,
    handleConnectionUpdateLayerFillBidirectional,
  };
}
