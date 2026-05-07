/**
 * T2-27: typed controller job execution contract.
 * Run: npx tsx tests/execute-job-output-contract.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import type { ControllerJobTicket, ControllerOutput } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ticket(): ControllerJobTicket {
  return {
    ticketId: 'ticket_t2_27',
    sceneHash: 'scene',
    profileHash: 'profile',
    outputHash: 'output',
  };
}

async function connectedController(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;
  return { ctrl, port };
}

async function capturesError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function run(): Promise<void> {
  console.log('\n=== T2-27 executeJob output contract ===\n');

  {
    const { ctrl } = await connectedController();
    const output: ControllerOutput = {
      kind: 'binary-job',
      bytes: new Uint8Array([1, 2, 3]),
      format: 'ruida',
    };
    const err = await capturesError(() => ctrl.executeJob(output, ticket()));
    assert(err !== null, 'GRBL rejects binary-job output');
    assert(err?.includes('gcode-lines') && err.includes('binary-job'), `binary rejection names expected and actual output (${err})`);
    await ctrl.disconnect();
  }

  {
    const { ctrl } = await connectedController();
    const output: ControllerOutput = {
      kind: 'gcode-lines',
      lines: ['G21', 'G90', 'G0 X1 Y1', 'M2'],
      dialect: 'marlin',
    };
    const err = await capturesError(() => ctrl.executeJob(output, ticket()));
    assert(err !== null, 'GRBL rejects non-GRBL gcode dialect');
    assert(err?.includes('grbl') && err.includes('marlin'), `dialect rejection names expected and actual dialect (${err})`);
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectedController();
    const output: ControllerOutput = {
      kind: 'gcode-lines',
      lines: ['G21', 'G90', 'G0 X1 Y1', 'M2'],
      dialect: 'grbl',
    };
    const handle = await ctrl.executeJob(output, ticket());
    assert(handle.id === 'ticket_t2_27', 'accepted job handle is tied to the ticket id');
    assert(ctrl.isJobRunning, 'GRBL gcode-lines output starts the line stream');
    while (ctrl.isJobRunning) {
      port.injectResponse('ok');
      await flush(2);
    }
    await ctrl.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
