/**
 * T3-34: raster G-code can be emitted through the streaming output seam.
 *
 * Run: npx tsx tests/raster-gcode-streaming.test.ts
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createEmptyJob,
  type Operation,
  type ProcessedBitmap,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { collectStreamingOutput, type GcodeChunk } from '../src/core/output/GcodeStreaming';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { EMPTY_OFFSET_TABLE } from '../src/core/plan/ScanningOffset';

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const settings: ResolvedLaserSettings = {
  powerMin: 0,
  powerMax: 75,
  speed: 1500,
  passes: 1,
  zStepPerPass: 0,
  fillInterval: 0.1,
  fillAngle: 0,
  fillMode: 'line',
  fillBiDirectional: true,
  overscanning: 0.5,
  overcut: 0,
  leadIn: 0,
  tabCount: 0,
  tabWidth: 0,
  insideFirst: false,
  airAssist: false,
  accelAwarePower: false,
  maxAccelMmPerS2: 1000,
  minPowerRatioAccel: 0.1,
  scanningOffsets: EMPTY_OFFSET_TABLE,
};

const bitmap: ProcessedBitmap = {
  width: 6,
  height: 4,
  dpi: 254,
  sourceObjectId: 'stream-raster-object',
  mode: '1bit',
  data: new Uint8Array([
    1, 1, 0, 0, 1, 1,
    0, 0, 0, 0, 0, 0,
    1, 0, 1, 0, 1, 0,
    0, 1, 1, 1, 0, 0,
  ]),
  physicalWidth: 6,
  physicalHeight: 4,
  position: { x: 12, y: 18 },
  pipeline: {
    brightness: 0,
    contrast: 0,
    gamma: 1,
    ditheringMode: 'threshold',
    inverted: false,
  },
};

function makeRasterJob(): ReturnType<typeof createEmptyJob> {
  const job = createEmptyJob('Raster streaming parity', 'test');
  const operation: Operation = {
    id: 'op-raster-stream',
    layerId: 'layer-raster-stream',
    layerName: 'Image',
    layerColor: '#22d3ee',
    order: 0,
    type: 'raster',
    settings,
    geometry: { type: 'raster', bitmap },
    bounds: {
      minX: bitmap.position.x,
      minY: bitmap.position.y,
      maxX: bitmap.position.x + bitmap.physicalWidth,
      maxY: bitmap.position.y + bitmap.physicalHeight,
    },
  };
  job.operations.push(operation);
  job.bounds = { ...operation.bounds };
  job.metadata.objectCount = 1;
  job.metadata.layerCount = 1;
  return job;
}

console.log('\n=== T3-34 raster G-code streaming ===\n');

void (async () => {
  const job = makeRasterJob();
  const plan = optimizePlan(job);
  const options = {
    startMode: 'absolute' as const,
    maxSpindle: 1000,
    returnPosition: null,
    clock: () => '2026-05-16T00:00:00.000Z',
  };

  const legacyStrategy = new GrblOutputStrategy();
  const legacyOutput = legacyStrategy.generate(plan, job, options);
  const legacyLines = legacyOutput.text?.split('\n') ?? [];

  const streamedStrategy = new GrblOutputStrategy();
  const chunks: GcodeChunk[] = [];
  for await (const chunk of streamedStrategy.generateGcode(plan, job, {
    ...options,
    chunkLines: 5,
  })) {
    chunks.push(chunk);
  }
  const streamed = await collectStreamingOutput((async function* () {
    for (const chunk of chunks) yield chunk;
  })());

  assert.deepEqual(streamed.lines, legacyLines);
  check(true, 'streaming GRBL output matches legacy generate() line-for-line');
  check(chunks.length > 1, `streaming output emits multiple chunks (got ${chunks.length})`);
  check(chunks.slice(0, -1).every(chunk => chunk.lines.length <= 5), 'non-terminal chunks respect chunkLines');
  check(chunks[chunks.length - 1]?.isLast === true, 'last chunk is terminal');
  check(streamed.lineCount === legacyLines.length, 'collected streaming line count matches legacy line count');
  check(streamed.sawLast === true, 'streaming collector sees terminal chunk');
  check(
    legacyLines.some(line => line.startsWith('M4 S0')),
    'fixture exercises modal-M4 raster output',
  );

  {
    const here = dirname(fileURLToPath(import.meta.url));
    const outputSrc = readFileSync(resolve(here, '../src/core/output/Output.ts'), 'utf-8');
    const streamingSrc = readFileSync(resolve(here, '../src/core/output/GcodeStreaming.ts'), 'utf-8');
    const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
    const roadmapSrc = readFileSync(resolve(here, '../docs/ROADMAP.md'), 'utf-8');
    const auditSrc = readFileSync(resolve(here, '../docs/ROADMAP-shipped-audit.md'), 'utf-8');
    const generateGcodeBody =
      outputSrc.match(/async \*generateGcode[\s\S]*?\n  private/)?.[0] ?? '';
    const t315RoadmapBlock =
      roadmapSrc.match(/### T3-15 \| Spool-based G-code output[\s\S]*?### T3-16 \|/)?.[0] ?? '';
    const t315AuditRow =
      auditSrc.match(/\| T3-15 \| Spool-based G-code output[\s\S]*?\n/)?.[0] ?? '';

    check(/async \*generateGcode/.test(outputSrc), 'BaseGCodeStrategy exposes generateGcode');
    check(/iterateGcodeLines/.test(generateGcodeBody), 'generateGcode reuses the shared G-code line iterator');
    check(!/this\.generate\(/.test(generateGcodeBody), 'generateGcode does not wrap legacy generate()');
    check(!/fromArray\(/.test(generateGcodeBody), 'generateGcode does not adapt a materialized legacy array');
    check(/GcodeChunk/.test(streamingSrc), 'GcodeStreaming chunk contract remains the output streaming surface');
    check(!/No production code consumes the streaming surface yet/.test(streamingSrc),
      'GcodeStreaming docs no longer claim the streaming surface is unused in production');
    check(/explicit[\s\S]*materialized export\/preview paths/.test(streamingSrc),
      'GcodeStreaming docs name the explicit materialized consumer path');
    check(/gcodeMaterialization/.test(pipelineSrc), 'PipelineService exposes explicit G-code materialization mode');
    check(/generateGcode/.test(pipelineSrc), 'PipelineService calls the streaming output surface');
    check(!/No live consumer of the streaming surface yet|Production memory profile remains at the pre-T3-15 8-stage shape/.test(t315RoadmapBlock),
      'T3-15 roadmap block no longer carries stale no-consumer wording');
    check(/PipelineService\.compileGcode` now consumes/.test(t315RoadmapBlock),
      'T3-15 roadmap block documents the partial streaming consumer');
    check(!/Production memory profile unchanged - 8-stage shape remains/.test(t315AuditRow),
      'T3-15 shipped-audit row no longer claims the original memory profile is fully unchanged');
    check(/partially improved/.test(t315AuditRow) && /PipelineService\.compileGcode/.test(t315AuditRow),
      'T3-15 shipped-audit row documents the partial production streaming improvement');
  }

  console.log(`\nT3-34 raster G-code streaming: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
