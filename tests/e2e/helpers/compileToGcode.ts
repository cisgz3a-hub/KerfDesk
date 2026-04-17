import { compileJob } from '../../../src/core/job/JobCompiler';
import { optimizePlan } from '../../../src/core/plan/PlanOptimizer';
import { applyMachineTransform } from '../../../src/core/plan/MachineTransform';
import { getOutputStrategy } from '../../../src/core/output/Output';
import '../../../src/core/output/GrblStrategy';
import type { Scene } from '../../../src/core/scene/Scene';
import type { GcodeStartMode } from '../../../src/core/output/GcodeOrigin';
import type { MachineOriginCorner } from '../../../src/core/devices/DeviceProfile';
import { EMPTY_OFFSET_TABLE } from '../../../src/core/plan/ScanningOffset';

export interface CompileOptions {
  machineWidth: number;
  machineHeight: number;
  originCorner?: MachineOriginCorner;
  startMode?: GcodeStartMode;
}

export function compileToGcode(scene: Scene, opts: CompileOptions): string {
  const job = compileJob(scene, { machineAccelMmPerS2: null });
  const plan = optimizePlan(job, { scanningOffsets: EMPTY_OFFSET_TABLE });
  const transformed = applyMachineTransform(plan, {
    startMode: opts.startMode ?? 'absolute',
    savedOrigin: null,
    originCorner: opts.originCorner ?? 'front-left',
    bedHeightMm: opts.machineHeight,
  });

  const strategy = getOutputStrategy('grbl');
  if (!strategy) throw new Error('GRBL output strategy not registered');

  const output = strategy.generate(transformed.plan, job, {
    startMode: opts.startMode ?? 'absolute',
    machineWidth: opts.machineWidth,
    machineHeight: opts.machineHeight,
  });

  const text = output.text ?? '';
  // G-code header includes an ISO Date line; normalize volatile metadata.
  return text
    .split('\n')
    .filter(line => !/^;\s*(Date|Time):/i.test(line))
    .join('\n');
}
