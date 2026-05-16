/**
 * T2-27: typed controller job execution contract.
 * Run: npx tsx tests/execute-job-output-contract.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import type { ControllerJobTicket, ControllerOutput } from '../src/controllers/ControllerInterface';
import { buildReplayableGcodeSpool, fromArray } from '../src/core/output/GcodeStreaming';
import fs from 'node:fs';

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

  {
    const { ctrl, port } = await connectedController();
    const output: ControllerOutput = {
      kind: 'gcode-stream',
      spool: await buildReplayableGcodeSpool(
        'ticket_t2_27_stream',
        options => fromArray(['G21', 'G90', 'G0 X2 Y2', 'M2'], options),
      ),
      dialect: 'grbl',
    };
    const handle = await ctrl.executeJob(output, {
      ...ticket(),
      ticketId: 'ticket_t2_27_stream',
    });
    assert(handle.id === 'ticket_t2_27_stream', 'gcode-stream job handle is tied to the ticket id');
    assert(ctrl.isJobRunning, 'GRBL gcode-stream output starts the line stream');
    while (ctrl.isJobRunning) {
      port.injectResponse('ok');
      await flush(2);
    }
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectedController();
    const lines = Array.from({ length: 5_000 }, (_, i) => `G0 X${i % 10} Y0`);
    const output: ControllerOutput = {
      kind: 'gcode-stream',
      spool: await buildReplayableGcodeSpool(
        'ticket_t2_27_large_stream',
        options => fromArray(lines, { ...options, chunkLines: 250 }),
      ),
      dialect: 'grbl',
    };
    const progressTotals = new Set<number>();
    const unsubscribe = ctrl.onProgress(progress => {
      progressTotals.add(progress.totalLines);
    });
    await ctrl.executeJob(output, {
      ...ticket(),
      ticketId: 'ticket_t2_27_large_stream',
    });
    assert(ctrl.isJobRunning, 'large gcode-stream starts running from the bounded window');
    let guard = 0;
    while (ctrl.isJobRunning && guard < lines.length + 100) {
      port.injectResponse('ok');
      await flush(1);
      guard++;
    }
    unsubscribe();
    assert(!ctrl.isJobRunning, 'large gcode-stream completes after refilling the bounded window');
    assert(progressTotals.has(lines.length), 'large gcode-stream progress reports the full stream line total');
    assert(port.received.filter(line => /^G0 X/.test(line)).length === lines.length,
      'large gcode-stream sends every streamed line');
    await ctrl.disconnect();
  }

  {
    const controllerSrc = fs.readFileSync('src/controllers/grbl/GrblController.ts', 'utf8');
    assert(
      !controllerSrc.includes('collectStreamingOutput'),
      'GRBL gcode-stream execution does not flatten through collectStreamingOutput',
    );
    const sendJobSpoolStart = controllerSrc.indexOf('private async sendJobSpool(');
    const sendJobSpoolEnd = controllerSrc.indexOf('private async _validateSpoolBeforeStreaming(', sendJobSpoolStart);
    const sendJobSpoolBody = controllerSrc.slice(sendJobSpoolStart, sendJobSpoolEnd);
    assert(sendJobSpoolBody.length > 500, 'located sendJobSpool body');
    const validationStart = controllerSrc.indexOf('private async _validateSpoolBeforeStreaming(');
    const validationEnd = controllerSrc.indexOf('private async _fillStreamWindow(', validationStart);
    const validationBody = controllerSrc.slice(validationStart, validationEnd);
    assert(validationBody.length > 500, 'located streaming validation body');
    assert(
      !/jobLines\.push\(\.\.\.parsed\.jobLines\)/.test(validationBody),
      'GRBL gcode-stream execution does not accumulate every parsed stream line before sending',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
