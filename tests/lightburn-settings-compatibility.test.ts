import { strict as assert } from 'node:assert';
import { createBlankProfile, saveDeviceProfile } from '../src/core/devices/DeviceProfile';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import type { Job } from '../src/core/job/Job';
import type { Plan } from '../src/core/plan/Plan';
import type { AABB } from '../src/core/types';

let passed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    });
}

function makeJobAndPlan(): { job: Job; plan: Plan } {
  const bounds: AABB = { minX: 0, minY: 0, maxX: 10, maxY: 0 };
  const job: Job = {
    id: 'lightburn-settings-job',
    name: 'LightBurn settings job',
    createdAt: '2026-01-01T00:00:00.000Z',
    operations: [
      {
        id: 'layer-1',
        layerId: 'layer-1',
        layerName: 'Layer 1',
        layerColor: '#ff0000',
        order: 0,
        type: 'cut',
        settings: {
          powerMin: 0,
          powerMax: 50,
          speed: 600,
          passes: 1,
          zStepPerPass: 0,
          fillInterval: 0,
          fillAngle: 0,
          fillMode: 'line',
          fillBiDirectional: false,
          overscanning: 0,
          overcut: 0,
          leadIn: 0,
          tabCount: 0,
          tabWidth: 0,
          insideFirst: false,
          airAssist: true,
          accelAwarePower: false,
          maxAccelMmPerS2: 1000,
          minPowerRatioAccel: 0,
          scanningOffsets: [],
        },
        geometry: { type: 'vector', paths: [] },
        bounds,
      },
    ],
    bounds,
    metadata: {
      objectCount: 1,
      layerCount: 1,
      sourceProjectId: 'lightburn-settings-project',
    },
  };
  const plan: Plan = {
    id: 'lightburn-settings-plan',
    jobId: job.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    operations: [
      {
        operationId: 'layer-1',
        layerName: 'Layer 1',
        layerColor: '#ff0000',
        passIndex: 0,
        moves: [
          { type: 'rapid', to: { x: 0, y: 0 } },
          { type: 'setAir', on: true },
          { type: 'laserOn', power: 50 },
          { type: 'linear', to: { x: 10, y: 0 }, speed: 600, power: 50 },
          { type: 'laserOff' },
          { type: 'setAir', on: false },
        ],
      },
    ],
    stats: {
      totalDistanceMm: 10,
      rapidDistanceMm: 0,
      cutDistanceMm: 10,
      estimatedTimeSeconds: 1,
      moveCount: 6,
      operationCount: 1,
      passCount: 1,
    },
    bounds,
  };
  return { job, plan };
}

function generateLines(options: Record<string, unknown> = {}): string[] {
  const { job, plan } = makeJobAndPlan();
  const strategy = new GrblOutputStrategy();
  const output = strategy.generate(plan, job, {
    clock: () => new Date('2026-01-01T00:00:00.000Z'),
    ...options,
  } as never);
  return (output.text ?? '').split(/\r?\n/);
}

async function main() {
  await test('GRBL constant-power mode emits M3 instead of hard-coded M4', () => {
    const lines = generateLines({ grblLaserPowerMode: 'constant-m3' });
    assert(lines.some(line => /^M3 S500\b/.test(line)), `expected M3 S500 in:\n${lines.join('\n')}`);
    assert(!lines.some(line => /^M4 S500\b/.test(line)), `did not expect M4 S500 in:\n${lines.join('\n')}`);
  });

  await test('GRBL dynamic-power mode remains the default M4 behavior', () => {
    const lines = generateLines();
    assert(lines.some(line => /^M4 S500\b/.test(line)), `expected default M4 S500 in:\n${lines.join('\n')}`);
  });

  await test('air assist command can be configured to use M7 instead of hard-coded M8', () => {
    const lines = generateLines({ airAssistCommand: 'M7' });
    assert(lines.some(line => /^M7\b/.test(line)), `expected M7 air assist ON in:\n${lines.join('\n')}`);
    assert(!lines.some(line => /^M8\b/.test(line)), `did not expect M8 air assist ON in:\n${lines.join('\n')}`);
    assert(lines.some(line => /^M9\b/.test(line)), `expected M9 air assist OFF in:\n${lines.join('\n')}`);
  });

  await test('profile validation rejects unsafe LightBurn-style settings values', () => {
    const profile = createBlankProfile('Invalid LightBurn settings');
    profile.id = 'invalid-lightburn-settings';
    profile.name = 'Invalid LightBurn settings';
    (profile as never as { grblLaserPowerMode: string }).grblLaserPowerMode = 'M106';
    (profile as never as { airAssistCommand: string }).airAssistCommand = 'M106';
    (profile as never as { scanningOffsets: Array<{ speedMmPerMin: number; offsetMm: number }> }).scanningOffsets = [
      { speedMmPerMin: -100, offsetMm: Number.NaN },
    ];

    assert.throws(
      () => saveDeviceProfile(profile),
      error => {
        const issues = (error as { issues?: Array<{ message: string }> }).issues ?? [];
        assert(
          issues.some(issue => /laser power mode|air assist|scanning offset/i.test(issue.message)),
          `expected validation errors for new machine settings, got ${JSON.stringify(issues, null, 2)}`,
        );
        return true;
      },
      'invalid machine settings should be rejected',
    );
  });

  console.log(`\n${passed} lightburn settings compatibility tests passed`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
