import { describe, expect, it } from 'vitest';
import { buildMotionManifest } from './motion-manifest';

describe('buildMotionManifest', () => {
  it('classifies powered laser moves, S0 gaps, and final parking from streamed lines', () => {
    const manifest = buildMotionManifest(
      [
        '; header',
        'G21',
        'G90',
        'M4 S0',
        'G0 X10 Y10 S0',
        'G1 X20 S500',
        'G1 X30 S0',
        'M5',
        'G0 X0 Y0 S0',
      ].join('\n'),
      { machineKind: 'laser', initialPosition: { x: 5, y: 5, z: 0 } },
    );
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      'travel',
      'process',
      'travel',
      'park',
    ]);
    expect(manifest.firstProcessPoint).toEqual({ x: 10, y: 10, z: 0 });
    expect(manifest.blocks[1]?.rawLineIndex).toBe(5);
    expect(manifest.blocks[1]?.sendableLineIndex).toBe(4);
    expect(manifest.blocks[1]?.programLineNumber).toBeNull();
  });

  it('samples helical CNC arcs and records Z geometry', () => {
    const manifest = buildMotionManifest(
      'G21\nG90\nM3 S12000\nG0 X10 Y0 Z0\nG2 X0 Y10 I-10 J0 Z-2',
      {
        machineKind: 'cnc',
      },
    );
    const arc = manifest.blocks.at(-1);
    expect(arc?.kind).toBe('process');
    expect(arc?.points.length).toBeGreaterThan(2);
    expect(arc?.points.at(-1)).toEqual({ x: 0, y: 10, z: -2 });
  });

  // A closed arc has equal endpoints but a non-zero route, so endpoint displacement
  // alone read it as a vertical plunge and lost the material entry (ADR-271 sect. 5).
  it('classifies a flat full-circle CNC arc as process, not a plunge', () => {
    const manifest = buildMotionManifest('G21\nG90\nM3 S12000\nG0 X5 Y0\nG2 X5 Y0 I-5 J0 F300', {
      machineKind: 'cnc',
    });
    const arc = manifest.blocks.at(-1);
    expect(arc?.kind).toBe('process');
    // Route length is the sampled chord sum, so it sits just under the true
    // circumference. Timing consumers inherit that bias; it is not an error.
    const circumferenceMm = 2 * Math.PI * 5;
    expect(arc?.lengthMm).toBeLessThan(circumferenceMm);
    expect(arc?.lengthMm).toBeGreaterThan(circumferenceMm * 0.99);
  });

  it('marks a flat full-circle laser cut as the material entry', () => {
    const manifest = buildMotionManifest('G21\nG90\nM4 S500\nG0 X5 Y0\nG2 X5 Y0 I-5 J0 F300', {
      machineKind: 'laser',
    });
    expect(manifest.blocks.at(-1)?.kind).toBe('process');
    expect(manifest.firstProcessPoint).toEqual({ x: 5, y: 0, z: 0 });
  });

  // The shape cnc-grbl-helical.ts emits for a helical entry: XY returns to the
  // start while Z descends. It cuts material the whole way, so it is not the
  // vertical plunge that endpoint displacement made it look like.
  it('classifies a closed helical entry as process, not a plunge', () => {
    const manifest = buildMotionManifest(
      'G21\nG90\nM3 S12000\nG0 X15 Y10 Z0\nG3 X15 Y10 Z-1 I-5 J0 F300',
      { machineKind: 'cnc' },
    );
    const helix = manifest.blocks.at(-1);
    expect(helix?.kind).toBe('process');
    expect(helix?.points.at(-1)).toEqual({ x: 15, y: 10, z: -1 });
  });

  it('still calls a pure-Z move a plunge when no XY route is swept', () => {
    const manifest = buildMotionManifest('G21\nG90\nM3 S12000\nG0 X1 Y1 Z2\nG1 Z-1 F100', {
      machineKind: 'cnc',
    });
    expect(manifest.blocks.at(-1)?.kind).toBe('plunge');
  });

  it('uses the first powered CNC plunge as the material-entry marker', () => {
    const manifest = buildMotionManifest('G21\nG90\nG0 X12 Y8 Z3\nM3 S12000\nG1 Z-1 F100\nG1 X20', {
      machineKind: 'cnc',
    });
    expect(manifest.firstProcessPoint).toEqual({ x: 12, y: 8, z: 3 });
  });

  it('applies inch and relative modes to exact geometry', () => {
    const manifest = buildMotionManifest('G20\nG91\nM3 S1\nG1 X1 Y0.5', {
      machineKind: 'laser',
      initialPosition: { x: 10, y: 20, z: 0 },
    });
    expect(manifest.blocks[0]?.points.at(-1)).toEqual({ x: 35.4, y: 32.7, z: 0 });
  });

  it('recognizes Marlin fan PWM as process power', () => {
    const manifest = buildMotionManifest('G21\nG90\nM107\nG0 X2\nM106 S128\nG1 X8\nM107', {
      machineKind: 'laser',
    });
    expect(manifest.firstProcessPoint).toEqual({ x: 2, y: 0, z: 0 });
    expect(manifest.blocks.map((block) => block.kind)).toEqual(['travel', 'process']);
  });

  it('classifies CNC tool-change and final park destinations', () => {
    const manifest = buildMotionManifest(
      'G21\nG90\nM3 S10000\nG1 X5\nM5\nG0 X0\nM0\nM3 S10000\nG1 X10\nM5\nG0 X0',
      { machineKind: 'cnc' },
    );
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      'process',
      'park',
      'process',
      'park',
    ]);
  });
});
