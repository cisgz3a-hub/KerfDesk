/**
 * T2-27: typed controller job execution contract.
 * Run: npx tsx tests/execute-job-output-contract.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import type { ControllerJobTicket, ControllerOutput } from '../src/controllers/ControllerInterface';
import { buildReplayableGcodeSpool, fromArray } from '../src/core/output/GcodeStreaming';
import type { GcodeChunk, SpoolHandle } from '../src/core/output/GcodeStreaming';
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
    const { ctrl, port } = await connectedController();
    const totalLines = 5_000;
    let producedBeforeFirstDeviceWrite = 0;
    let terminalChunkBeforeFirstDeviceWrite = false;
    const spool: SpoolHandle = {
      id: 'ticket_t2_27_bounded_first_send',
      contentHash: 'bounded-first-send',
      lineCount: totalLines,
      byteCount: totalLines * 10,
      usesM4: false,
      open: () => (async function* (): AsyncGenerator<GcodeChunk> {
        for (let i = 0; i < totalLines; i++) {
          const hasWrittenJobLine = port.received.some(line => /^G0 X/.test(line));
          if (!hasWrittenJobLine) producedBeforeFirstDeviceWrite = i + 1;
          if (i === totalLines - 1 && !hasWrittenJobLine) {
            terminalChunkBeforeFirstDeviceWrite = true;
          }
          yield {
            lines: [`G0 X${i % 10} Y0`],
            cumulativeLineCount: i + 1,
            isLast: i === totalLines - 1,
          };
        }
      })(),
    };
    const output: ControllerOutput = {
      kind: 'gcode-stream',
      spool,
      dialect: 'grbl',
    };
    await ctrl.executeJob(output, {
      ...ticket(),
      ticketId: 'ticket_t2_27_bounded_first_send',
    });
    assert(!terminalChunkBeforeFirstDeviceWrite,
      'gcode-stream start does not consume the terminal spool chunk before first device write');
    assert(producedBeforeFirstDeviceWrite > 0 && producedBeforeFirstDeviceWrite < totalLines,
      `gcode-stream start performs bounded pre-send work (produced ${producedBeforeFirstDeviceWrite}/${totalLines})`);
    assert(port.received.some(line => /^G0 X/.test(line)),
      'gcode-stream start writes an initial bounded window to the device');
    ctrl.stop();
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectedController();
    let produced = 0;
    const totalLines = 50;
    const spool: SpoolHandle = {
      id: 'ticket_t2_27_validation_abort',
      contentHash: 'validation-abort',
      lineCount: totalLines,
      byteCount: totalLines * 10,
      usesM4: false,
      open: (options) => (async function* (): AsyncGenerator<GcodeChunk> {
        for (let i = 0; i < totalLines; i++) {
          if (options?.signal?.aborted) return;
          produced++;
          if (i === 2) {
            ctrl.stop();
          }
          await flush(0);
          yield {
            lines: [`G0 X${i % 10} Y0`],
            cumulativeLineCount: i + 1,
            isLast: i === totalLines - 1,
          };
        }
      })(),
    };
    const output: ControllerOutput = {
      kind: 'gcode-stream',
      spool,
      dialect: 'grbl',
    };
    const err = await capturesError(() => ctrl.executeJob(output, {
      ...ticket(),
      ticketId: 'ticket_t2_27_validation_abort',
    }));
    assert(err !== null && /abort|cancel/i.test(err),
      `stop during initial spool window fill rejects start (got ${err ?? 'no error'})`);
    assert(!ctrl.isJobRunning, 'stop during initial spool window fill leaves no running job');
    assert(produced < totalLines,
      `stop during initial spool window fill aborts before terminal chunk (produced=${produced})`);
    assert(port.received.filter(line => /^G0 X/.test(line)).length === 0,
      'stop during initial spool window fill sends no job motion lines');
    await ctrl.disconnect();
  }

  {
    const controllerSrc = fs.readFileSync('src/controllers/grbl/GrblController.ts', 'utf8');
    assert(
      !controllerSrc.includes('collectStreamingOutput'),
      'GRBL gcode-stream execution does not flatten through collectStreamingOutput',
    );
    const sendJobSpoolStart = controllerSrc.indexOf('private async sendJobSpool(');
    const sendJobSpoolEnd = controllerSrc.indexOf('private _throwIfSpoolStreamingAborted(', sendJobSpoolStart);
    const sendJobSpoolBody = controllerSrc.slice(sendJobSpoolStart, sendJobSpoolEnd);
    assert(sendJobSpoolBody.length > 500, 'located sendJobSpool body');
    assert(
      !/_validateSpoolBeforeStreaming/.test(controllerSrc),
      'GRBL gcode-stream start no longer performs a full pre-send spool validation pass',
    );
    assert(
      /spool\.open\(\{\s*signal:\s*streamAbortController\.signal\s*\}\)/.test(sendJobSpoolBody),
      'GRBL gcode-stream opens the start spool with a cancellation signal',
    );
    const fillStart = controllerSrc.indexOf('private async _fillStreamWindow(');
    const fillEnd = controllerSrc.indexOf('private _handleStreamFillError(', fillStart);
    const fillBody = controllerSrc.slice(fillStart, fillEnd);
    assert(fillBody.length > 500, 'located streaming window fill body');
    assert(
      /checkGrblJobBoundsChunk/.test(fillBody),
      'GRBL gcode-stream validates bounds as each bounded stream window is filled',
    );
    assert(
      /this\._jobLines\.length < STREAM_JOB_WINDOW_LINES/.test(fillBody),
      'GRBL gcode-stream fill remains bounded by STREAM_JOB_WINDOW_LINES',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
