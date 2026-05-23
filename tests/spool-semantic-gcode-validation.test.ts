/**
 * Ticket-only start jobs must get the same emitted-G-code semantic safety scan
 * as materialized/export jobs without rebuilding the full G-code string.
 * Run: npx tsx tests/spool-semantic-gcode-validation.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { createBlankProfile } from '../src/core/devices/DeviceProfile';
import { PREFLIGHT_CODES, runPreflightSummary } from '../src/core/preflight/Preflight';
import {
  validateEmittedGcode,
  validateEmittedGcodeChunks,
} from '../src/core/preflight/rules/OutputValidator';
import { createScene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';
import { fromArray } from '../src/core/output/GcodeStreaming';
import type { MachineState } from '../src/controllers/ControllerInterface';

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeScene() {
  const scene = createScene(300, 300, 'Spool semantic validation');
  scene.objects = [createRect(scene.layers[0].id, 10, 10, 20, 20)];
  return scene;
}

function codes(findings: readonly { code: string }[]): string[] {
  return findings.map(finding => finding.code);
}

async function run(): Promise<void> {
  console.log('\n=== spool semantic G-code validation ===\n');

  const unsafeLines = [
    'G21',
    'G17',
    'G90',
    'G94',
    'M5 S0',
    'M3 S500',
    'G0 X10 Y10',
    'M117 hello',
    'M5 S0',
  ];

  const fullFindings = validateEmittedGcode(unsafeLines.join('\n'), { maxSpindle: 1000 });
  const chunkFindings = await validateEmittedGcodeChunks(
    fromArray(unsafeLines, { chunkLines: 2 }),
    { maxSpindle: 1000 },
  );
  assert.deepEqual(
    codes(chunkFindings).sort(),
    codes(fullFindings).sort(),
    'stream validator reports the same semantic codes as full-text validation',
  );
  assert(
    codes(chunkFindings).includes(PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'stream validator blocks M3 rapid with non-zero S',
  );
  assert(
    codes(chunkFindings).includes(PREFLIGHT_CODES.OUTPUT_UNSUPPORTED_COMMAND),
    'stream validator blocks unsupported emitted M-codes',
  );

  const safeLines = [
    'G21',
    'G17',
    'G90',
    'G94',
    'M5 S0',
    'M4 S500',
    'G1 X10 Y0 F1000',
    'M5 S0',
    'M2',
  ];
  assert.equal(
    (await validateEmittedGcodeChunks(fromArray(safeLines, { chunkLines: 1 }), { maxSpindle: 1000 })).length,
    0,
    'safe streamed G-code produces no semantic findings',
  );

  const profile = createBlankProfile('spool semantic profile');
  profile.bedWidth = 300;
  profile.bedHeight = 300;
  profile.maxSpindle = 1000;
  const summary = runPreflightSummary(
    makeScene(),
    null,
    idle,
    300,
    300,
    { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    false,
    true,
    1000,
    null,
    'absolute',
    null,
    true,
    {
      hasGcode: true,
      outputUsesM4: false,
      outputSemanticFindings: chunkFindings,
    },
  );
  assert(
    summary.issues.some(issue => issue.id === PREFLIGHT_CODES.OUTPUT_RAPID_WITH_LASER_ON),
    'preflight can surface ticket-only semantic findings without emitted G-code text',
  );

  const pipelineSrc = readFileSync('src/app/PipelineService.ts', 'utf8');
  assert(
    /validateEmittedGcodeChunks\(\s*gcodeSpool\.open/.test(pipelineSrc),
    'PipelineService validates the replayable spool directly',
  );

  console.log('\nspool semantic G-code validation: passed\n');
}

void run().catch(error => {
  console.error(error);
  process.exit(1);
});
