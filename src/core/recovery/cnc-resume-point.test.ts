import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isSendableGcodeLine } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { emitCncJobWithPassSpans } from '../output';
import { rawResumeLine } from './job-checkpoint';
import {
  CNC_RESUME_PLANNER_RESERVE_LINES,
  resolveCncResumePoint,
  type CncResumePointArgs,
} from './cnc-resume-point';

const RESERVE = CNC_RESUME_PLANNER_RESERVE_LINES['grbl-v1.1'];

function testGroup(passes: ReadonlyArray<CncPass>, toolId?: string): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    ...(toolId === undefined ? {} : { toolId }),
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

// A 40-point open polyline: 39 cut lines per pass, so pass spans dwarf the
// grbl planner reserve and targeted proven frontiers stay inside the program.
function longLine(y: number): CncPass {
  return {
    kind: 'contour',
    zMm: -1 - y / 100,
    polyline: Array.from({ length: 40 }, (_, i) => ({ x: i, y })),
    closed: false,
  };
}

const job: Job = { groups: [testGroup([longLine(0), longLine(5), longLine(10)])] };
const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
const rawLines = gcode.split('\n');
const sendableTotal = rawLines.filter(isSendableGcodeLine).length;

// Sendable lines with raw number ≤ raw — converts a raw position to the
// checkpoint's acked-sendable numbering.
function sendableThrough(raw: number): number {
  return rawLines.slice(0, raw).filter(isSendableGcodeLine).length;
}

// Acked count whose proven frontier (acked − reserve) lands exactly at raw
// line R, i.e. R is the first line NOT provably executed.
function ackedForProvenFrontier(raw: number): number {
  return sendableThrough(raw - 1) + RESERVE;
}

function args(overrides: Partial<CncResumePointArgs>): CncResumePointArgs {
  return {
    gcode,
    ackedLines: 0,
    spans,
    controllerKind: 'grbl-v1.1',
    streamingMode: 'char-counted',
    rxBufferBytes: 128,
    ...overrides,
  };
}

describe('resolveCncResumePoint', () => {
  it('targets the pass whose span contains the proven frontier', () => {
    const secondSpanStart = spans[1]?.firstRawLine ?? 0;
    const acked = ackedForProvenFrontier(secondSpanStart);
    expect(acked).toBeLessThanOrEqual(sendableTotal);
    const point = resolveCncResumePoint(args({ ackedLines: acked }));
    expect(point).toMatchObject({
      kind: 'resume-at-pass',
      groupIndex: 0,
      passIndex: 1,
      provenCompletePassCount: 1,
      firstUnprovenRawLine: secondSpanStart,
    });
  });

  it('pulls the boundary back across a pass edge by the planner reserve', () => {
    // Acked a few lines into pass 2's span: the reserve rewinds the proven
    // frontier into pass 1, so the default boundary is the EARLIER pass.
    const acked = sendableThrough((spans[1]?.firstRawLine ?? 0) + 4);
    const point = resolveCncResumePoint(args({ ackedLines: acked }));
    expect(point).toMatchObject({ kind: 'resume-at-pass', groupIndex: 0, passIndex: 0 });
  });

  it('defaults to the first pass when nothing is provably executed', () => {
    const point = resolveCncResumePoint(args({ ackedLines: 3 }));
    expect(point).toMatchObject({
      kind: 'resume-at-pass',
      passIndex: 0,
      provenCompletePassCount: 0,
      firstUnprovenRawLine: 1,
    });
  });

  it('still rewinds into the final pass when every line was acknowledged', () => {
    // Full acks do not prove full execution: the planner may have lost up to
    // the reserve, which reaches back past the 3-line postamble into pass 3.
    const point = resolveCncResumePoint(args({ ackedLines: sendableTotal }));
    expect(point).toMatchObject({
      kind: 'resume-at-pass',
      groupIndex: 0,
      passIndex: 2,
      provenCompletePassCount: 2,
    });
  });

  it('maps a proven frontier inside a tool-change gap to the next pass', () => {
    const multiTool: Job = {
      groups: [testGroup([longLine(0)], 'tool-a'), testGroup([longLine(5)], 'tool-b')],
    };
    const emission = emitCncJobWithPassSpans(multiTool, DEFAULT_DEVICE_PROFILE);
    const m0Raw = emission.gcode.split('\n').findIndex((line) => line === 'M0') + 1;
    expect(m0Raw).toBeGreaterThan(0);
    const ackedThroughM0 =
      emission.gcode
        .split('\n')
        .slice(0, m0Raw - 1)
        .filter(isSendableGcodeLine).length + RESERVE;
    const point = resolveCncResumePoint(
      args({ gcode: emission.gcode, spans: emission.spans, ackedLines: ackedThroughM0 }),
    );
    expect(point).toMatchObject({ kind: 'resume-at-pass', groupIndex: 1, passIndex: 0 });
  });

  it('reports after-last-pass when the proven frontier clears every span', () => {
    const tail = Array.from({ length: 40 }, (_, i) => `G1 X${i} Y0`).join('\n') + '\n';
    const point = resolveCncResumePoint(
      args({
        gcode: tail,
        spans: [{ groupIndex: 0, passIndex: 0, firstRawLine: 1, lastRawLine: 3 }],
        ackedLines: 40,
      }),
    );
    expect(point).toEqual({ kind: 'after-last-pass' });
  });

  it('refuses empty and malformed span sidecars', () => {
    expect(resolveCncResumePoint(args({ spans: [] }))).toEqual({ kind: 'no-pass-spans' });
    expect(
      resolveCncResumePoint(
        args({
          spans: [
            { groupIndex: 0, passIndex: 0, firstRawLine: 1, lastRawLine: 5 },
            { groupIndex: 0, passIndex: 1, firstRawLine: 5, lastRawLine: 9 },
          ],
        }),
      ),
    ).toEqual({ kind: 'invalid-spans' });
    expect(
      resolveCncResumePoint(
        args({
          spans: [
            { groupIndex: 0, passIndex: 0, firstRawLine: 1, lastRawLine: rawLines.length + 5 },
          ],
        }),
      ),
    ).toEqual({ kind: 'invalid-spans' });
  });

  it('bounds the possible frontier to the one in-flight line under ping-pong', () => {
    const acked = sendableThrough((spans[1]?.firstRawLine ?? 0) + 10);
    const point = resolveCncResumePoint(args({ ackedLines: acked, streamingMode: 'ping-pong' }));
    if (point.kind !== 'resume-at-pass') throw new Error(point.kind);
    expect(point.lastPossiblyExecutedRawLine).toBe(rawResumeLine(gcode, acked));
  });

  it('bounds the possible frontier by RX-buffer bytes under char-counted', () => {
    const acked = sendableThrough((spans[0]?.firstRawLine ?? 0) + 10);
    const rxBufferBytes = 64;
    const point = resolveCncResumePoint(args({ ackedLines: acked, rxBufferBytes }));
    if (point.kind !== 'resume-at-pass') throw new Error(point.kind);
    const firstUnacked = rawResumeLine(gcode, acked);
    expect(point.lastPossiblyExecutedRawLine).toBeGreaterThanOrEqual(firstUnacked);
    const inFlight = rawLines
      .slice(firstUnacked - 1, point.lastPossiblyExecutedRawLine)
      .filter(isSendableGcodeLine);
    const usedBytes = inFlight.reduce((sum, line) => sum + line.length + 1, 0);
    expect(usedBytes).toBeLessThanOrEqual(rxBufferBytes);
    const next = rawLines
      .slice(point.lastPossiblyExecutedRawLine)
      .find((line) => isSendableGcodeLine(line));
    if (next !== undefined) {
      expect(usedBytes + next.length + 1).toBeGreaterThan(rxBufferBytes);
    }
  });

  it('never places the boundary after the first unacknowledged line (200 seeds)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: sendableTotal }), (acked) => {
        const point = resolveCncResumePoint(args({ ackedLines: acked }));
        if (point.kind !== 'resume-at-pass') return;
        expect(point.firstUnprovenRawLine).toBeLessThanOrEqual(rawResumeLine(gcode, acked));
        const spanIndex = spans.findIndex(
          (span) => span.groupIndex === point.groupIndex && span.passIndex === point.passIndex,
        );
        expect(point.provenCompletePassCount).toBe(spanIndex);
      }),
      { numRuns: 200 },
    );
  });
});
