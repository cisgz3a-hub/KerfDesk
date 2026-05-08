/**
 * T3-92: "Go to last position" is a session-local motion helper.
 *
 * Run: npx tsx tests/last-machine-position.test.ts
 */
import {
  buildGoToLastPositionJogs,
  captureLastJobStartPosition,
  describeLastMachinePosition,
} from '../src/app/LastMachinePosition';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T3-92 last machine position helper ===\n');

{
  const captured = captureLastJobStartPosition({ x: 12.345, y: 67.89, z: 0 }, 1234);
  assertContract(
    captured?.x === 12.345
    && captured.y === 67.89
    && captured.capturedAt === 1234
    && captured.source === 'job-start',
    'captureLastJobStartPosition stores finite XY job-start coordinates',
  );
}

{
  const captured = captureLastJobStartPosition({ x: Number.NaN, y: 10, z: 0 }, 1234);
  assertContract(captured === null, 'captureLastJobStartPosition rejects non-finite coordinates');
}

{
  const moves = buildGoToLastPositionJogs({
    current: { x: 0, y: 0 },
    target: { x: 20, y: 15, capturedAt: 1, source: 'job-start' },
  });
  assertContract(
    moves.length === 2
    && moves[0]?.axis === 'X'
    && moves[0]?.distance === 20
    && moves[1]?.axis === 'Y'
    && moves[1]?.distance === 15,
    'buildGoToLastPositionJogs returns relative X/Y jogs from current to target',
  );
}

{
  const moves = buildGoToLastPositionJogs({
    current: { x: 20.004, y: 14.996 },
    target: { x: 20, y: 15, capturedAt: 1, source: 'job-start' },
    toleranceMm: 0.01,
  });
  assertContract(moves.length === 0, 'buildGoToLastPositionJogs omits no-op movement inside tolerance');
}

{
  const moves = buildGoToLastPositionJogs({
    current: null,
    target: { x: 20, y: 15, capturedAt: 1, source: 'job-start' },
  });
  assertContract(moves.length === 0, 'buildGoToLastPositionJogs refuses unknown current position');
}

{
  const label = describeLastMachinePosition({ x: 20, y: 15, capturedAt: 1, source: 'job-start' });
  assertContract(label === 'X20.0 Y15.0', 'describeLastMachinePosition formats the stored target for UI tooltips');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
