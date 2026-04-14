import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type Move } from '../../core/plan/Plan';
import { type GcodeStartMode } from '../../core/output/GcodeOrigin';
import {
  compileGcode as pipelineCompileGcode,
  compileToolpath as pipelineCompileToolpath,
  type CompileGcodeResult,
} from '../../app/PipelineService';

export function useGcodeExport(
  startMode: GcodeStartMode = 'current',
  savedOrigin: { x: number; y: number } | null = null,
  /** GRBL $30 from controller when device profile omits maxSpindle. */
  controllerMaxSpindle: number | null = null,
) {
  const [currentGcode, setCurrentGcode] = useState<string | null>(null);
  const [lastCompileResult, setLastCompileResult] = useState<CompileGcodeResult | null>(null);

  const compileGcode = useCallback(async (targetScene: Scene): Promise<string | null> => {
    try {
      const result = await pipelineCompileGcode(targetScene, startMode, savedOrigin, controllerMaxSpindle);
      setLastCompileResult(result);
      if (!result) return null;
      return result.gcode;
    } catch (err) {
      console.error('G-code compilation failed:', err);
      setLastCompileResult(null);
      return null;
    }
  }, [startMode, savedOrigin, controllerMaxSpindle]);

  const compileToolpathMoves = useCallback(async (targetScene: Scene): Promise<Move[] | null> => {
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
    compileToolpathMoves,
    /** Full result from the last compileGcode call — includes transform, bounds, warnings. */
    lastCompileResult,
  };
}
