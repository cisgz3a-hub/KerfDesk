import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import {
  alongLineCoordinate,
  fitCircleThroughRun,
  fitLineThroughRun,
  pointInLineFrame,
  quadraticFitFromStats,
  runFrameStats,
} from './run-fit';

describe('fitLineThroughRun', () => {
  it('recovers a known line and yields ~zero residuals', () => {
    // Points exactly on y = 2x + 1.
    const pts: Vec2[] = [];
    for (let x = -5; x <= 5; x += 1) pts.push({ x, y: 2 * x + 1 });
    const line = fitLineThroughRun(pts, 0, pts.length - 1);
    // Direction is parallel to (1,2) up to sign.
    const slope = line.dy / line.dx;
    expect(Math.abs(slope - 2)).toBeLessThan(1e-6);
    // Every point's perpendicular residual is ~0.
    const stats = runFrameStats(pts, 0, pts.length - 1, line, 1);
    expect(stats.maxAbsResidual).toBeLessThan(1e-6);
  });

  it('fits a vertical line (double-angle branch) without blowing up', () => {
    const pts: Vec2[] = [];
    for (let y = 0; y <= 10; y += 1) pts.push({ x: 3, y });
    const line = fitLineThroughRun(pts, 0, pts.length - 1);
    expect(Math.abs(line.dx)).toBeLessThan(1e-6); // direction ≈ (0, ±1)
    const stats = runFrameStats(pts, 0, pts.length - 1, line, 1);
    expect(stats.maxAbsResidual).toBeLessThan(1e-6);
  });
});

describe('fitCircleThroughRun (Kasa)', () => {
  it('recovers a known circle centre and radius', () => {
    const cx = 10;
    const cy = -4;
    const r = 40;
    const pts: Vec2[] = [];
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * 2 * Math.PI;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    const circle = fitCircleThroughRun(pts, 0, pts.length - 1);
    expect(circle).not.toBeNull();
    if (circle === null) return;
    expect(Math.abs(circle.cx - cx)).toBeLessThan(1e-6);
    expect(Math.abs(circle.cy - cy)).toBeLessThan(1e-6);
    expect(Math.abs(circle.r - r)).toBeLessThan(1e-6);
  });

  it('returns null for collinear points (degenerate normal system)', () => {
    const pts: Vec2[] = [];
    for (let x = 0; x <= 8; x += 1) pts.push({ x, y: 0.5 * x });
    expect(fitCircleThroughRun(pts, 0, pts.length - 1)).toBeNull();
  });

  it('returns null for an effectively-straight arc (radius past the cap)', () => {
    // A gigantic-radius arc reads as a line; the fit must reject it rather
    // than return an astronomical circle.
    const r = 1e7;
    const pts: Vec2[] = [];
    for (let x = -4; x <= 4; x += 1) pts.push({ x, y: r - Math.sqrt(r * r - x * x) });
    expect(fitCircleThroughRun(pts, 0, pts.length - 1)).toBeNull();
  });
});

describe('quadraticFitFromStats', () => {
  it('drives residual RMS to ~zero on a genuine parabola', () => {
    // Shallow parabola: the TLS line is ~horizontal, residuals follow s².
    const pts: Vec2[] = [];
    for (let x = -8; x <= 8; x += 1) pts.push({ x, y: 0.05 * x * x });
    const line = fitLineThroughRun(pts, 0, pts.length - 1);
    const stats = runFrameStats(pts, 0, pts.length - 1, line, 5);
    const n = pts.length;
    const lineRms = Math.sqrt(stats.residualSumSq / n);
    const quad = quadraticFitFromStats(stats, n);
    expect(quad).not.toBeNull();
    if (quad === null) return;
    // The quadratic explains the bow the line cannot: dramatically lower RMS.
    expect(quad.rms).toBeLessThan(lineRms * 0.05);
    expect(quad.rms).toBeLessThan(1e-6);
  });

  it('returns null when the normal system is degenerate', () => {
    // Three coincident points → all moments collapse, det ≈ 0.
    const pts: Vec2[] = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ];
    const line = fitLineThroughRun(pts, 0, 2);
    const stats = runFrameStats(pts, 0, 2, line, 1);
    expect(quadraticFitFromStats(stats, 3)).toBeNull();
  });
});

describe('line-frame coordinates round-trip', () => {
  it('pointInLineFrame is the inverse of the frame projection at r=0', () => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 8 },
    ];
    const line = fitLineThroughRun(pts, 0, 2);
    for (const p of pts) {
      const s = alongLineCoordinate(line, p);
      const back = pointInLineFrame(line, s, 0);
      // p sits on the line, so its foot at (s, r=0) is p itself.
      expect(Math.hypot(back.x - p.x, back.y - p.y)).toBeLessThan(1e-9);
    }
  });
});
