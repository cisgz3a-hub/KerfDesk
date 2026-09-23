import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import type { Vec2 } from '../../core/scene';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { setAppThemePreference } from '../theme/app-theme';
import { canvasTheme } from '../theme/canvas-theme';
import type { MarkerBox } from './canvas-motion-marker-layout';
import { drawCanvasStartMarkers } from './draw-canvas-motion-markers';
import { drawCanvasMotionOverlay } from './draw-canvas-motion';

afterEach(() => setAppThemePreference('light'));

function recordingContext() {
  const plates: MarkerBox[] = [];
  const labels: Array<{ text: string; alpha: number }> = [];
  const strokes: Array<{ points: Vec2[]; color: string; width: number }> = [];
  let points: Vec2[] = [];
  const ctx = {
    globalAlpha: 1,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: () => undefined,
    restore: () => undefined,
    setLineDash: () => undefined,
    measureText: (text: string) => ({ width: text.length * 7 }),
    beginPath: () => {
      points = [];
    },
    moveTo: (x: number, y: number) => {
      points.push({ x, y });
    },
    lineTo: (x: number, y: number) => {
      points.push({ x, y });
    },
    closePath: () => undefined,
    roundRect: (x: number, y: number, width: number, height: number) => {
      plates.push({ x, y, width, height });
    },
    fill: () => undefined,
    stroke: () => {
      strokes.push({ points: [...points], color: ctx.strokeStyle, width: ctx.lineWidth });
    },
    fillText: (text: string) => {
      labels.push({ text, alpha: ctx.globalAlpha });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, plates, labels, strokes };
}

function markerPlan(frame: Vec2, job = frame): CanvasMotionPlan {
  const gcode = 'G21\nG90\nM5\nG0 X0 Y0\nG1 X10 F1000';
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'markers',
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, bedWidth: 358, bedHeight: 268 },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [frame, { x: frame.x + 10, y: frame.y }],
    jobStart: job,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

describe('planned start rendering', () => {
  it.each([false, true])(
    'keeps rendered plates outside artwork while preserving exact start leaders (updating=%s)',
    (updating) => {
      const recording = recordingContext();
      const point = { x: 0, y: 160 };
      const view = { scale: 1.25, offsetX: 170, offsetY: 160 };
      const artwork = { x: 161, y: 271, width: 168, height: 98 };
      drawCanvasMotionOverlay(
        recording.ctx,
        { plan: markerPlan(point), run: null, planIsCurrent: !updating },
        view,
        { width: 650, height: 570 },
        [artwork],
      );
      expect(recording.plates).toHaveLength(2);
      for (const plate of recording.plates) {
        expect(
          plate.x + plate.width <= artwork.x ||
            plate.x >= artwork.x + artwork.width ||
            plate.y + plate.height <= artwork.y ||
            plate.y >= artwork.y + artwork.height,
        ).toBe(true);
      }
      const leaders = recording.strokes.filter((stroke) => stroke.width === 1.25);
      expect(leaders).toHaveLength(2);
      for (const leader of leaders) expect(leader.points[0]).toEqual({ x: 170, y: 360 });
      expect(recording.labels.filter(({ text }) => text === 'Updating…')).toHaveLength(
        updating ? 2 : 0,
      );
      expect(
        recording.labels.filter(({ text }) => text.endsWith(' start')).map(({ text }) => text),
      ).toEqual(['Frame start', 'Job start']);
    },
  );

  it('keeps anchor glyphs and labels the same pixel size across zoom', () => {
    const point = { x: 40, y: 25 };
    const plan = markerPlan(point);
    const sizes: number[][] = [];
    for (const scale of [0.25, 1, 6]) {
      const recording = recordingContext();
      const view = { scale, offsetX: 30, offsetY: 30 };
      drawCanvasStartMarkers(recording.ctx, plan, view, false, { width: 600, height: 400 });
      const x = 30 + point.x * scale;
      const y = 30 + point.y * scale;
      const diamond = recording.strokes.find(
        (stroke) =>
          stroke.color === canvasTheme.frameStart &&
          stroke.width === 2 &&
          stroke.points[0]?.x === x &&
          stroke.points[0].y === y - 8,
      );
      expect(diamond?.points).toEqual([
        { x, y: y - 8 },
        { x: x + 8, y },
        { x, y: y + 8 },
        { x: x - 8, y },
      ]);
      const triangle = recording.strokes.find(
        (stroke) =>
          stroke.color === canvasTheme.jobStart &&
          stroke.width === 2 &&
          stroke.points[0]?.x === x - 3 &&
          stroke.points[0].y === y - 4,
      );
      expect(triangle?.points).toEqual([
        { x: x - 3, y: y - 4 },
        { x: x + 4, y },
        { x: x - 3, y: y + 4 },
      ]);
      sizes.push(recording.plates.flatMap((plate) => [plate.width, plate.height]));
      expect(recording.labels).toEqual([
        { text: 'Frame start', alpha: 1 },
        { text: 'Job start', alpha: 1 },
      ]);
    }
    expect(sizes[0]).toEqual(sizes[1]);
    expect(sizes[1]).toEqual(sizes[2]);
  });

  it.each([
    { point: { x: 0, y: 0 }, view: { scale: 0.15, offsetX: 30, offsetY: 30 } },
    { point: { x: 358, y: 268 }, view: { scale: 1, offsetX: 30, offsetY: 30 } },
    { point: { x: 358, y: 268 }, view: { scale: 4, offsetX: -1200, offsetY: -900 } },
  ])(
    'keeps both updating names inside the viewport after zoom or pan ($view.scale)',
    ({ point, view }) => {
      const recording = recordingContext();
      drawCanvasStartMarkers(recording.ctx, markerPlan(point), view, true, {
        width: 500,
        height: 350,
      });
      expect(recording.plates).toHaveLength(2);
      for (const box of recording.plates) {
        expect(box.x).toBeGreaterThanOrEqual(30);
        expect(box.y).toBeGreaterThanOrEqual(30);
        expect(box.x + box.width).toBeLessThanOrEqual(494);
        expect(box.y + box.height).toBeLessThanOrEqual(344);
      }
      const [a, b] = recording.plates;
      if (a === undefined || b === undefined) throw new Error('Missing marker plate');
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ).toBe(true);
      expect(recording.labels.filter((label) => label.text === 'Updating…')).toHaveLength(2);
    },
  );

  it.each(['light', 'dark'] as const)(
    'keeps marker text and glyphs legible in %s mode',
    (theme) => {
      setAppThemePreference(theme);
      expect(contrast(canvasTheme.artworkInk, canvasTheme.motionLabelPlate)).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const accent of [canvasTheme.frameStart, canvasTheme.jobStart]) {
        expect(contrast(accent, canvasTheme.motionLabelPlate)).toBeGreaterThanOrEqual(3);
      }
      expect(canvasTheme.frameStart).not.toBe(canvasTheme.jobStart);
    },
  );
});

function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r = 0, g = 0, blue = 0] = (hex.slice(1).match(/../g) ?? []).map((pair) => {
      const channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const left = luminance(a);
  const right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
