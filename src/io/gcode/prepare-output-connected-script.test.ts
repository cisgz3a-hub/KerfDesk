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
const FONT_FIXTURE_DIRECTORY = '../../ui/text/fonts';
const COMPILATION_JOB_ID = 'real-connected-script-equivalence';
const EXPECTED_OBJECT_COUNT = 8;
const EXPECTED_LAYER_COUNT = 6;
const MAX_PREPARATION_MS = 30_000;
const TEST_TIMEOUT_MS = 90_000;
const GCODE_REVIEW_EDGE_LINES = 5;
const GCODE_REVIEW_SAMPLES = 7;
const GCODE_LINE_SEPARATOR = '\n';
const UTF8_ENCODING = 'utf8';

async function loadFixtureFont(fontKey: string): Promise<ArrayBuffer> {
  const file = FONT_FILE_BY_KEY[fontKey];
  if (file === undefined) throw new Error(`No fixture font for ${fontKey}`);
  const bytes = readFileSync(resolve(__dirname, FONT_FIXTURE_DIRECTORY, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

it(
  'keeps real connected-script multi-operation plans and emitted bytes exact',
  async () => {
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
        jobId: COMPILATION_JOB_ID,
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

    expect(project.scene.objects).toHaveLength(EXPECTED_OBJECT_COUNT);
    expect(project.scene.layers).toHaveLength(EXPECTED_LAYER_COUNT);
    expect(regionTasks).toBeGreaterThan(1);
    expect(parallel).toEqual(serial);
    expect(serial.ok).toBe(true);
    expect(parallel.ok).toBe(true);
    if (!serial.ok || !parallel.ok) return;
    const serialEmission = emitPreparedGcode(serial);
    const parallelEmission = emitPreparedGcode(parallel);
    expect(reviewableGcodeSnapshot(serialEmission.gcode)).toMatchSnapshot();
    expect(parallelEmission).toEqual(serialEmission);
    expect(fingerprintGcode(parallelEmission.gcode)).toEqual(
      fingerprintGcode(serialEmission.gcode),
    );
    expect(serialElapsedMs).toBeLessThan(MAX_PREPARATION_MS);
    expect(parallelElapsedMs).toBeLessThan(MAX_PREPARATION_MS);
    console.info(
      `[connected-script-perf] regions=${regionTasks} serial=${serialElapsedMs.toFixed(1)}ms ` +
        `out-of-order=${parallelElapsedMs.toFixed(1)}ms bytes=${serialEmission.gcode.length}`,
    );
  },
  TEST_TIMEOUT_MS,
);

function reviewableGcodeSnapshot(gcode: string) {
  const lines = gcode.split(GCODE_LINE_SEPARATOR);
  const lastIndex = Math.max(0, lines.length - 1);
  return {
    fingerprint: fingerprintGcode(gcode),
    lineCount: lines.length,
    head: lines.slice(0, GCODE_REVIEW_EDGE_LINES),
    samples: Array.from({ length: GCODE_REVIEW_SAMPLES }, (_, sampleIndex) => {
      const lineIndex = Math.round((lastIndex * sampleIndex) / (GCODE_REVIEW_SAMPLES - 1));
      return { lineIndex, line: lines[lineIndex] };
    }),
    tail: lines.slice(-GCODE_REVIEW_EDGE_LINES),
    utf8ByteCount: Buffer.byteLength(gcode, UTF8_ENCODING),
  };
}
