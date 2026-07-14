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
