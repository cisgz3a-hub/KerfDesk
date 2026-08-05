import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { connectedScriptCanvasCompilationProject } from '../../__fixtures__/connected-script-canvas-compilation-project';
import { runCncCompilationTask } from '../../core/cnc/cnc-compilation-artifact';
import { fingerprintGcode } from '../../core/recovery';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

const FONT_FILE_BY_KEY: Readonly<Record<string, string>> = {
  'dancing-script-regular': 'DancingScript-Regular.ttf',
  'pacifico-regular': 'Pacifico-Regular.ttf',
};

async function loadFixtureFont(fontKey: string): Promise<ArrayBuffer> {
  const file = FONT_FILE_BY_KEY[fontKey];
  if (file === undefined) throw new Error(`No fixture font for ${fontKey}`);
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

it('keeps real connected-script multi-operation plans and emitted bytes exact', async () => {
  const project = await connectedScriptCanvasCompilationProject(loadFixtureFont);
  const serialStarted = performance.now();
  const serial = prepareOutput(project);
  const serialElapsedMs = performance.now() - serialStarted;
  let regionTasks = 0;
  const parallelStarted = performance.now();
  const parallel = await prepareOutputAsync(
    project,
    {},
    {
      jobId: 'real-connected-script-equivalence',
      runCncTasks: async ({ jobId, tasks }) => {
        regionTasks = tasks.length;
        return tasks
          .map((task) => ({
            jobId,
            taskId: task.taskId,
            result: runCncCompilationTask(task.payload),
          }))
          .reverse();
      },
    },
  );
  const parallelElapsedMs = performance.now() - parallelStarted;

  expect(project.scene.objects).toHaveLength(8);
  expect(project.scene.layers).toHaveLength(6);
  expect(regionTasks).toBeGreaterThan(1);
  expect(parallel).toEqual(serial);
  const serialEmission = emitPreparedGcode(serial);
  const parallelEmission = emitPreparedGcode(parallel);
  expect(parallelEmission).toEqual(serialEmission);
  expect(fingerprintGcode(parallelEmission.gcode)).toEqual(fingerprintGcode(serialEmission.gcode));
  expect(serialElapsedMs).toBeLessThan(30_000);
  expect(parallelElapsedMs).toBeLessThan(30_000);
  console.info(
    `[connected-script-perf] regions=${regionTasks} serial=${serialElapsedMs.toFixed(1)}ms ` +
      `out-of-order=${parallelElapsedMs.toFixed(1)}ms bytes=${serialEmission.gcode.length}`,
  );
}, 90_000);
