import type { Scene } from '../../../src/core/scene/Scene';
import { compileJob } from '../../../src/core/job/JobCompiler';
import { optimizePlan } from '../../../src/core/plan/PlanOptimizer';
import { applyMachineTransform } from '../../../src/core/plan/MachineTransform';
import { getOutputStrategy } from '../../../src/core/output/Output';
import type { GcodeStartMode } from '../../../src/core/output/GcodeOrigin';
import type { MachineOriginCorner } from '../../../src/core/devices/DeviceProfile';
import '../../../src/core/output/GrblStrategy'; // side-effect: registers GRBL

export interface CompileOptions {
  startMode?: GcodeStartMode;
  savedOrigin?: { x: number; y: number } | null;
  originCorner?: MachineOriginCorner;
}

/**
 * Runs the full compile pipeline and returns deterministic G-code text.
 *
 * Normalization: strips header lines that vary between runs
 * (timestamps, ids, versions) so snapshots are byte-stable.
 */
export function compileSceneToGcode(scene: Scene, opts: CompileOptions = {}): string {
  const startMode = opts.startMode ?? 'current';
  const savedOrigin = opts.savedOrigin ?? null;
  const job = compileJob(scene);
  const plan = optimizePlan(job);
  const machineTransform = applyMachineTransform(plan, {
    startMode,
    savedOrigin,
    originCorner: opts.originCorner ?? 'front-left',
    bedHeightMm: scene.canvas.height,
  });
  const { plan: machinePlan, returnPosition } = machineTransform;
  const strategy = getOutputStrategy('grbl');
  if (!strategy) throw new Error('GRBL output strategy not registered');

  const output = strategy.generate(machinePlan, job, {
    startMode,
    savedOrigin,
    returnPosition,
  });
  if (!output.text) throw new Error('Compile produced no text output');

  return normalize(output.text);
}

/**
 * Strip lines that vary between otherwise-identical runs.
 * - Lines matching /^; Generated: / (timestamps)
 * - Lines matching /^; Version: / (version stamps if present)
 * - Lines matching /^; Id: / (uuid-like ids if present)
 * - Lines matching /^; Date: / (ISO timestamps from default header)
 * - Lines matching /^; Time: / (precautionary)
 *
 * Everything else — including semantic comments like feed rates and bounds —
 * must be preserved.
 */
function normalize(gcode: string): string {
  const lines = gcode.split(/\r?\n/);
  const stable = lines.filter(line => {
    if (/^;\s*Generated:/i.test(line)) return false;
    if (/^;\s*Version:/i.test(line)) return false;
    if (/^;\s*Id:/i.test(line)) return false;
    if (/^;\s*Date:/i.test(line)) return false;
    if (/^;\s*Time:/i.test(line)) return false;
    return true;
  });
  return stable.join('\n').replace(/\n+$/, '\n');
}
