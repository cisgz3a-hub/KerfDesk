/**
 * Pipeline orchestration — standalone, no React dependency.
 *
 * Owns the full compile chain:
 *   Scene → expandText → Job → Plan → MachineTransform → Output
 *
 * Returns structured results so callers (React hooks, tests, CLI)
 * get everything they need in one call.
 */

import { type Scene } from '../core/scene/Scene';
import { type AABB } from '../core/types';
import { type Move } from '../core/plan/Plan';
import { type MachineTransformResult, applyMachineTransform } from '../core/plan/MachineTransform';
import { type GcodeStartMode } from '../core/output/GcodeOrigin';
import { type OutputFormat } from '../core/output/Output';
import { compileJob } from '../core/job/JobCompiler';
import { optimizePlan } from '../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../core/output/Output';
import { getActiveProfile } from '../core/devices/DeviceProfile';
import { expandTextOutlinesForCompile } from '../geometry/expandTextForCompile';

// ─── RESULT TYPES ──────────────────────────────────────────────

export interface CompileGcodeResult {
  gcode: string;
  machineTransform: MachineTransformResult;
  machinePlanBounds: AABB;
  /** Canvas-space moves for toolpath preview overlay. */
  canvasMoves: Move[];
  canvasPlanBounds: AABB;
  failedTextObjects: string[];
}

export interface CompileToolpathResult {
  moves: Move[];
  bounds: AABB;
  failedTextObjects: string[];
}

// ─── COMPILE G-CODE ────────────────────────────────────────────

/**
 * Full pipeline: Scene → G-code string + all intermediate data.
 *
 * Returns null if the scene produces no operations (empty/hidden layers).
 */
export async function compileGcode(
  scene: Scene,
  startMode: GcodeStartMode = 'current',
  savedOrigin: { x: number; y: number } | null = null,
  /** Auto-detected GRBL $30. Fallback when device profile has no maxSpindle. */
  controllerMaxSpindle: number | null = null,
  outputFormat: OutputFormat = 'grbl',
): Promise<CompileGcodeResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}. These text objects will be excluded from the job. Try a larger font size or bolder font.`,
    );
  }

  const job = compileJob(sceneForJob);
  if (job.operations.length === 0) return null;

  const profile = getActiveProfile();

  const plan = optimizePlan(job, {
    maxRapidSpeed: profile?.maxFeedRate ?? 6000,
  });

  // Canvas-space data for preview
  const canvasMoves = plan.operations.flatMap(op => op.moves);
  const canvasPlanBounds = { ...plan.bounds };

  const flipY = profile?.invertY ?? true;

  const maxSpindle =
    profile?.maxSpindle
    ?? (controllerMaxSpindle != null && controllerMaxSpindle > 0 ? controllerMaxSpindle : null)
    ?? 1000;

  // Machine-space data for output
  const machineTransform = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    flipY,
  });

  const strategy = getOutputStrategy(outputFormat);
  if (!strategy) return null;

  const output = strategy.generate(machineTransform.plan, job, {
    returnPosition: (profile?.returnToOrigin ?? true)
      ? machineTransform.returnPosition
      : null,
    customStartGcode: profile?.startGcode,
    customEndGcode: profile?.endGcode,
    maxSpindle,
  });
  if (!output.text) return null;

  return {
    gcode: output.text,
    machineTransform,
    machinePlanBounds: { ...machineTransform.plan.bounds },
    canvasMoves,
    canvasPlanBounds,
    failedTextObjects,
  };
}

// ─── COMPILE TOOLPATH ──────────────────────────────────────────

/**
 * Compile scene to canvas-space moves for toolpath preview.
 * Does NOT apply MachineTransform — coordinates stay in canvas space.
 */
export async function compileToolpath(
  scene: Scene,
): Promise<CompileToolpathResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}`,
    );
  }

  const job = compileJob(sceneForJob);
  if (job.operations.length === 0) return null;

  const profile = getActiveProfile();
  const plan = optimizePlan(job, {
    maxRapidSpeed: profile?.maxFeedRate ?? 6000,
  });
  const moves = plan.operations.flatMap(op => op.moves);

  return {
    moves,
    bounds: { ...plan.bounds },
    failedTextObjects,
  };
}
