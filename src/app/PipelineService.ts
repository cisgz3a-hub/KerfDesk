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
import { compileJob } from '../core/job/JobCompiler';
import { optimizePlan } from '../core/plan/PlanOptimizer';
import { getOutputStrategy } from '../core/output/Output';
import '../core/output/GrblStrategy'; // register strategy
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
): Promise<CompileGcodeResult | null> {
  const { scene: sceneForJob, failedTextObjects } = await expandTextOutlinesForCompile(scene);

  if (failedTextObjects.length > 0) {
    console.warn(
      `[LaserForge] Text outline conversion failed for: ${failedTextObjects.join(', ')}. These text objects will be excluded from the job. Try a larger font size or bolder font.`,
    );
  }

  const job = compileJob(sceneForJob);
  if (job.operations.length === 0) return null;

  const plan = optimizePlan(job);

  // Canvas-space data for preview
  const canvasMoves = plan.operations.flatMap(op => op.moves);
  const canvasPlanBounds = { ...plan.bounds };

  // Machine-space data for output
  const machineTransform = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    flipY: true,
  });

  const strategy = getOutputStrategy('grbl');
  if (!strategy) return null;

  const output = strategy.generate(machineTransform.plan, job);
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

  const plan = optimizePlan(job);
  const moves = plan.operations.flatMap(op => op.moves);

  return {
    moves,
    bounds: { ...plan.bounds },
    failedTextObjects,
  };
}
