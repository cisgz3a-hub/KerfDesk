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

export type { CompileGcodeResult };

export interface UseCompileManagerOptions {
  scene: Scene;
  startMode: GcodeStartMode;
  savedOrigin: { x: number; y: number } | null;
  controllerMaxSpindle: number | null;
  /** Auto-detected bed from GRBL $$ ($130/$131) when available. */
  machineBedFromController: { width: number; height: number } | null;
  connectionSidebarOpen: boolean;
  outputFormat?: OutputFormat;
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
    connectionSidebarOpen,
    outputFormat = 'grbl',
  } = options;

  const [currentGcode, setCurrentGcode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CompileGcodeResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);

  const sceneRevisionRef = useRef(0);
  const [sceneCompileTick, setSceneCompileTick] = useState(0);
  const sceneCompileTickRef = useRef(0);
  sceneCompileTickRef.current = sceneCompileTick;

  const lastCompiledRevisionRef = useRef<number | null>(null);
  const [gcodeStale, setGcodeStale] = useState(false);

  useLayoutEffect(() => {
    sceneRevisionRef.current += 1;
    setSceneCompileTick(sceneRevisionRef.current);
  }, [scene, startMode, savedOrigin, controllerMaxSpindle, machineBedFromController]);

  useEffect(() => {
    if (!connectionSidebarOpen) return;
    if (
      lastCompiledRevisionRef.current !== null &&
      lastCompiledRevisionRef.current !== sceneCompileTick
    ) {
      setGcodeStale(true);
    }
  }, [sceneCompileTick, connectionSidebarOpen]);

  const compileToResult = useCallback(
    (targetScene: Scene) =>
      pipelineCompileGcode(
        targetScene,
        startMode,
        savedOrigin,
        controllerMaxSpindle,
        outputFormat,
        machineBedFromController,
      ),
    [startMode, savedOrigin, controllerMaxSpindle, outputFormat, machineBedFromController],
  );

  const compileGcode = useCallback(
    async (targetScene: Scene): Promise<string | null> => {
      setIsCompiling(true);
      try {
        const result = await pipelineCompileGcode(
          targetScene,
          startMode,
          savedOrigin,
          controllerMaxSpindle,
          outputFormat,
          machineBedFromController,
        );
        setLastResult(result);
        // Match previous App behavior: any finished compile attempt (including empty job)
        // clears the sidebar stale flag; thrown errors skip this in `catch` below.
        lastCompiledRevisionRef.current = sceneCompileTickRef.current;
        setGcodeStale(false);
        if (!result) {
          return null;
        }
        return result.gcode;
      } catch (err) {
        console.error('G-code compilation failed:', err);
        setLastResult(null);
        return null;
      } finally {
        setIsCompiling(false);
      }
    },
    [startMode, savedOrigin, controllerMaxSpindle, outputFormat, machineBedFromController],
  );

  const compileToolpath = useCallback(async (targetScene: Scene): Promise<readonly Move[] | null> => {
    try {
      const result = await pipelineCompileToolpath(targetScene);
      if (!result) return null;
      return result.moves;
    } catch (err) {
      console.error('Toolpath compilation failed:', err);
      return null;
    }
  }, []);

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
