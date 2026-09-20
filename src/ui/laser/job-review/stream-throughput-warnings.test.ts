import { describe, expect, it } from 'vitest';
import type { StartStreamWindow } from '../../state/laser-job-effective-stream-options';
import {
  detectStreamThroughputWarnings,
  MIN_BUFFERED_MOTION_MS,
  MIN_TRANSPORT_WARNING_SECONDS,
  OVERSIZED_LINE_WARNING_PREFIX,
  TRANSPORT_SHARE_WARNING,
  TRANSPORT_WARNING_PREFIX,
  type StreamThroughputInput,
} from './stream-throughput-warnings';

// A dithered raster row shape: alternating 13/16-byte `G1 X.. S..` lines.
function rasterProgram(lineCount: number): string {
  const lines = ['G21', 'G90', 'M4 S0'];
  for (let i = 0; i < lineCount; i += 1) {
    lines.push(`G1 X${((i + 1) * 0.1).toFixed(3)} S${i % 2 === 0 ? 0 : 1000}`);
  }
  lines.push('M5');
  return `${lines.join('\n')}\n`;
}

const STOCK: StartStreamWindow = {
  streamingMode: 'char-counted',
  bytes: 120,
  requestedBytes: 120,
  source: 'stock-fallback',
  provenBytes: null,
};
const GRBLHAL: StartStreamWindow = {
  streamingMode: 'char-counted',
  bytes: 1024,
  requestedBytes: 1024,
  source: 'controller-reported',
  provenBytes: 4096,
};

// 1000 raster lines of 0.1 mm at 3000 mm/min = 100 mm / (50 mm/s) = 2 s, so
// ~2 ms of motion per line — the dense case the window has to cover.
const PROGRAM = rasterProgram(1000);

function input(overrides: Partial<StreamThroughputInput> = {}): StreamThroughputInput {
  return {
    gcode: PROGRAM,
    motionSeconds: 2,
    transportSeconds: 0,
    window: GRBLHAL,
    controllerKind: 'grblhal',
    ...overrides,
  };
}

describe('detectStreamThroughputWarnings buffered motion (ADR-331)', () => {
  it('warns that a 120-byte window holds only milliseconds of dense raster motion', () => {
    const warnings = detectStreamThroughputWarnings(input({ window: STOCK }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Buffered streaming keeps only ~7 lines \(~1\d ms of motion\)/);
    expect(warnings[0]).toContain("controller's 120-byte receive window");
    expect(warnings[0]).toContain('$10 buffer-state bit');
    expect(MIN_BUFFERED_MOTION_MS).toBe(50);
  });

  it('stays silent once a controller-proven 1024-byte window buffers enough motion', () => {
    expect(detectStreamThroughputWarnings(input())).toEqual([]);
  });

  it('names a reported ring that narrowed the profile request', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ window: { ...GRBLHAL, bytes: 247, provenBytes: 247 } }),
    );

    expect(warnings[0]).toContain('reported a 247-byte usable buffer');
    expect(warnings[0]).toContain("profile's 1024-byte request");
  });

  it('points a proven-but-unused window at the Machine Setup field', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ window: { ...GRBLHAL, bytes: 120, requestedBytes: 120, provenBytes: 4096 } }),
    );

    expect(warnings[0]).toContain('reported room for 4096 bytes');
    expect(warnings[0]).toContain('raise the RX window in Machine Setup');
  });

  it('tells a stock GRBL operator that the firmware cannot hold more', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ window: STOCK, controllerKind: 'grbl-v1.1' }),
    );

    expect(warnings[0]).toContain('Stock GRBL cannot hold more than its 128-byte receive buffer');
  });

  it('treats ping-pong streaming as one line in flight', () => {
    const warnings = detectStreamThroughputWarnings(
      input({
        window: { ...STOCK, streamingMode: 'ping-pong', source: 'profile' },
        controllerKind: 'marlin',
      }),
    );

    expect(warnings[0]).toMatch(/^Buffered streaming keeps only one acknowledged line/);
    expect(warnings[0]).toContain('acknowledges one line at a time');
  });

  it('does not nag about small programs or ones without a motion estimate', () => {
    expect(
      detectStreamThroughputWarnings(input({ gcode: rasterProgram(50), window: STOCK })),
    ).toEqual([]);
    expect(detectStreamThroughputWarnings(input({ motionSeconds: 0, window: STOCK }))).toEqual([]);
  });
});

describe('detectStreamThroughputWarnings serial delivery (ADR-331)', () => {
  it('warns when estimated delivery cannot hide under the planned motion', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ motionSeconds: 100, transportSeconds: 30 }),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.startsWith(TRANSPORT_WARNING_PREFIX)).toBe(true);
    expect(warnings[0]).toContain('about 30 s longer than the motion itself');
    expect(warnings[0]).toContain('no matter how much the controller buffers');
  });

  it('reports long overhead in minutes', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ motionSeconds: 600, transportSeconds: 180 }),
    );

    expect(warnings[0]).toContain('about 3 min longer');
  });

  it('ignores delivery overhead that is brief or a small share of the job', () => {
    expect(
      detectStreamThroughputWarnings(input({ motionSeconds: 100, transportSeconds: 0.5 })),
    ).toEqual([]);
    expect(
      detectStreamThroughputWarnings(input({ motionSeconds: 100, transportSeconds: 4 })),
    ).toEqual([]);
    expect(MIN_TRANSPORT_WARNING_SECONDS).toBe(1);
    expect(TRANSPORT_SHARE_WARNING).toBe(0.05);
  });
});

describe('detectStreamThroughputWarnings unsendable lines (ADR-331)', () => {
  // Readiness checks the PROFILE request (1024 on grblHAL) while Start checks
  // the window actually resolved, so without this the refusal would surface
  // only after a completed Frame.
  const longLine = `G1 X1.000 ${'Y0.000 '.repeat(40)}S1000`;

  it('warns before Frame that Start cannot send a line wider than the window', () => {
    const warnings = detectStreamThroughputWarnings(
      input({ gcode: `G21\n${longLine}\nM5\n`, window: STOCK, motionSeconds: 1 }),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.startsWith(`${OVERSIZED_LINE_WARNING_PREFIX} 2 is `)).toBe(true);
    expect(warnings[0]).toContain('120-byte window this controller session allows');
    expect(warnings[0]).toContain('Start cannot send it');
  });

  it('stays silent when the resolved window fits the widest line', () => {
    expect(
      detectStreamThroughputWarnings(input({ gcode: `G21\n${longLine}\nM5\n`, motionSeconds: 1 })),
    ).toEqual([]);
  });
});
