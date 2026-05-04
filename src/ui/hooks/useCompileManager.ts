import {
  useState,
  useCallback,
  useRef,
  useLayoutEffect,
  useEffect,
} from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type Move } from '../../core/plan/Plan';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';
import { type OutputFormat } from '../../core/output/Output';
import {
  compileGcode as pipelineCompileGcode,
  compileToolpath as pipelineCompileToolpath,
  type CompileGcodeResult,
} from '../../app/PipelineService';
import { getActiveProfile } from '../../core/devices/DeviceProfile';

export type { CompileGcodeResult };

export interface UseCompileManagerOptions {
  scene: Scene;
  startMode: GcodeStartMode;
  savedOrigin: { x: number; y: number } | null;
  controllerMaxSpindle: number | null;
  /** Auto-detected bed from GRBL $$ ($130/$131) when available. */
  machineBedFromController: { width: number; height: number } | null;
  /** Min of GRBL $120/$121 when available. */
  controllerAccelMmPerS2: number | null;
  connectionSidebarOpen: boolean;
  outputFormat?: OutputFormat;
  /** When true, suppress sceneCompileTick bumps — avoids main-thread compiles during streaming. */
  isJobRunning: boolean;
}

export interface UseCompileManagerResult {
  currentGcode: string | null;
  setCurrentGcode: React.Dispatch<React.SetStateAction<string | null>>;
  compileGcode: (targetScene: Scene) => Promise<string | null>;
  compileToolpath: (targetScene: Scene) => Promise<readonly Move[] | null>;
  /**
   * Full Scene → Job → Plan → machine transform → G-code pipeline, without mutating
   * stale-tracking or `lastResult`. Use for live job overlay (same math as export).
   */
  compileToResult: (targetScene: Scene) => Promise<CompileGcodeResult | null>;
  gcodeStale: boolean;
  setGcodeStale: React.Dispatch<React.SetStateAction<boolean>>;
  lastResult: CompileGcodeResult | null;
  isCompiling: boolean;
  sceneCompileTick: number;
}

/**
 * Owns compile orchestration + G-code staleness vs scene/start origin (O(1) tick invalidation).
 */
export function useCompileManager(options: UseCompileManagerOptions): UseCompileManagerResult {
  const {
    scene,
    startMode,
    savedOrigin,
    controllerMaxSpindle,
    machineBedFromController,
    controllerAccelMmPerS2,
    connectionSidebarOpen,
    outputFormat = 'grbl',
    isJobRunning,
  } = options;

  const [currentGcode, setCurrentGcode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CompileGcodeResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);

  const sceneRevisionRef = useRef(0);
  const [sceneCompileTick, setSceneCompileTick] = useState(0);
  const sceneCompileTickRef = useRef(0);
  sceneCompileTickRef.current = sceneCompileTick;
  const savedOriginRef = useRef(savedOrigin);
  savedOriginRef.current = savedOrigin;
  const machineBedFromControllerRef = useRef(machineBedFromController);
  machineBedFromControllerRef.current = machineBedFromController;

  const lastCompiledRevisionRef = useRef<number | null>(null);
  // T1-57: monotonic request id so an older compile cannot commit its
  // result on top of a newer one. Each `compileGcode` call captures
  // its id at start; if the id no longer matches at completion time
  // (because a later compile incremented the ref), the result and
  // its `setLastResult` / `setGcodeStale` / `setIsCompiling` updates
  // are dropped. Closes the race where the user edits the scene
  // mid-compile and the older, stale result wins lastWriteWins.
  const compileRequestIdRef = useRef(0);
  const [gcodeStale, setGcodeStaleState] = useState(false);
  const gcodeStaleRef = useRef(false);
  const setGcodeStale = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((next) => {
    setGcodeStaleState(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      gcodeStaleRef.current = resolved;
      return prev === resolved ? prev : resolved;
    });
  }, []);

  // T1-99: savedOrigin is intentionally NOT a compile-invalidation
  // dependency. computeGcodeOffset accepts it as `_savedOrigin` and does
  // not use the value; Set Origin changes GRBL WCS via G10 L20, while the
  // emitted coordinate stream stays byte-identical.
  const machineBedWidth = machineBedFromController?.width ?? null;
  const machineBedHeight = machineBedFromController?.height ?? null;

  useLayoutEffect(() => {
    if (isJobRunning) return;
    sceneRevisionRef.current += 1;
    setSceneCompileTick(sceneRevisionRef.current);
  }, [
    scene,
    startMode,
    controllerMaxSpindle,
    machineBedWidth,
    machineBedHeight,
    controllerAccelMmPerS2,
    isJobRunning,
  ]);

  useEffect(() => {
    if (!connectionSidebarOpen) return;
    if (
      lastCompiledRevisionRef.current !== null &&
      lastCompiledRevisionRef.current !== sceneCompileTick &&
      !gcodeStaleRef.current
    ) {
      setGcodeStale(true);
    }
  }, [sceneCompileTick, connectionSidebarOpen, setGcodeStale]);

  const compileToResult = useCallback(
    (targetScene: Scene) => {
      if (isJobRunning) {
        console.warn('[useCompileManager] compileToResult suppressed: job is running');
        return Promise.resolve(null);
      }
      // T1-58: snapshot the active profile at compile entry so the pipeline
      // is pure w.r.t. profile state. If the active profile changes mid-
      // compile (programmatic update, import, cross-tab event), we still
      // produce a result for the profile the user thought was active.
      const profileSnapshot = getActiveProfile();
      return pipelineCompileGcode(
        targetScene,
        startMode,
        savedOriginRef.current,
        controllerMaxSpindle,
        outputFormat,
        machineBedFromControllerRef.current,
        controllerAccelMmPerS2,
        profileSnapshot,
      );
    },
    [
      startMode,
      controllerMaxSpindle,
      outputFormat,
      controllerAccelMmPerS2,
      isJobRunning,
    ],
  );

  const compileGcode = useCallback(
    async (targetScene: Scene): Promise<string | null> => {
      // Defense in depth: never compile during a running job. Compiles block the
      // main thread and starve the WiFi bridge event loop, causing GRBL's planner
      // buffer to drain and the laser to physically stop. A.1 fix.
      if (isJobRunning) {
        console.warn('[useCompileManager] compileGcode suppressed: job is running');
        return null;
      }
      // T1-57: capture this compile's request id and the scene tick
      // it actually compiled against. If a newer compile overtakes this
      // one before await resolves, drop our result. The tick captured
      // here (not at completion) is what `lastCompiledRevisionRef`
      // gets set to — otherwise an older compile finishing after a
      // scene edit would falsely mark its older result as fresh
      // against the newer tick.
      const requestId = ++compileRequestIdRef.current;
      const sceneTickAtStart = sceneCompileTickRef.current;
      // T1-58: profile snapshot taken alongside the request-id and scene-tick
      // snapshots so the entire compile attempt sees a consistent triple.
      const profileSnapshot = getActiveProfile();
      setIsCompiling(true);
      try {
        const result = await pipelineCompileGcode(
          targetScene,
          startMode,
          savedOriginRef.current,
          controllerMaxSpindle,
          outputFormat,
          machineBedFromControllerRef.current,
          controllerAccelMmPerS2,
          profileSnapshot,
        );
        if (requestId !== compileRequestIdRef.current) {
          console.info('[useCompileManager] dropping stale compile result (request superseded)');
          return null;
        }
        setLastResult(result);
        // Match previous App behavior: any finished compile attempt (including empty job)
        // clears the sidebar stale flag; thrown errors skip this in `catch` below.
        lastCompiledRevisionRef.current = sceneTickAtStart;
        setGcodeStale(false);
        if (!result) {
          return null;
        }
        return result.gcode;
      } catch (err) {
        if (requestId === compileRequestIdRef.current) {
          console.error('G-code compilation failed:', err);
          setLastResult(null);
        }
        return null;
      } finally {
        if (requestId === compileRequestIdRef.current) {
          setIsCompiling(false);
        }
      }
    },
    [
      startMode,
      controllerMaxSpindle,
      outputFormat,
      controllerAccelMmPerS2,
      isJobRunning,
      setGcodeStale,
    ],
  );

  const compileToolpath = useCallback(async (targetScene: Scene): Promise<readonly Move[] | null> => {
    if (isJobRunning) {
      console.warn('[useCompileManager] compileToolpath suppressed: job is running');
      return null;
    }
    try {
      // T1-58: profile snapshot for compileToolpath as well.
      const profileSnapshot = getActiveProfile();
      const result = await pipelineCompileToolpath(targetScene, controllerAccelMmPerS2, profileSnapshot);
      if (!result) return null;
      return result.moves;
    } catch (err) {
      console.error('Toolpath compilation failed:', err);
      return null;
    }
  }, [controllerAccelMmPerS2, isJobRunning]);

  return {
    currentGcode,
    setCurrentGcode,
    compileGcode,
    compileToolpath,
    compileToResult,
    gcodeStale,
    setGcodeStale,
    lastResult,
    isCompiling,
    sceneCompileTick,
  };
}
