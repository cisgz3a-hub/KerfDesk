// Store-level tests: capture ingestion (full-res re-detect), rejection
// reasons, and solve wiring. The full pixels→detect→sweep→calibrate accuracy
// path is proven in core (detect-checkerboard e2e); here we assert the store
// choreography around it stays correct.

import { beforeEach, describe, expect, it } from 'vitest';
import { renderCheckerboardView } from '../../../core/camera/board-render-fixtures';
import type { GrayImage, RgbaImage } from '../../../core/camera';
import { useCameraWizardStore } from './camera-wizard-store';

const SPEC = { rows: 6, cols: 9 };

function grayToRgba(img: GrayImage): RgbaImage {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round(img.data[i] ?? 0)));
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

function boardFrame(): RgbaImage {
  return grayToRgba(
    renderCheckerboardView({
      width: 320,
      height: 240,
      k: { fx: 180, fy: 180, cx: 160, cy: 120 },
      d: [-0.18, 0.03, 0, 0],
      spec: SPEC,
      spacingMm: 11,
      rvec: [0, 0, 0],
      tvec: [-44, -27.5, 95],
    }),
  );
}

function blankFrame(width: number, height: number): RgbaImage {
  return { data: new Uint8ClampedArray(width * height * 4).fill(128), width, height };
}

beforeEach(() => {
  useCameraWizardStore.getState().openWizard();
});

describe('camera-wizard-store', () => {
  it('openWizard resets to a fresh setup step', () => {
    useCameraWizardStore.getState().setStep('review');
    useCameraWizardStore.getState().openWizard();
    const s = useCameraWizardStore.getState();
    expect(s.open).toBe(true);
    expect(s.step).toBe('setup');
    expect(s.session).toEqual({ kind: 'collecting', captures: [] });
  });

  it('a board frame becomes a full-resolution capture', () => {
    useCameraWizardStore.getState().addCaptureFrame(boardFrame());
    const s = useCameraWizardStore.getState();
    expect(s.lastRejection).toBeNull();
    expect(s.session.captures).toHaveLength(1);
    expect(s.session.captures[0]?.imagePoints).toHaveLength(54);
    expect(s.frameWidth).toBe(320);
    expect(s.lastFrame).not.toBeNull();
  });

  it('a frame with no board is rejected with a reason', () => {
    useCameraWizardStore.getState().addCaptureFrame(blankFrame(320, 240));
    const s = useCameraWizardStore.getState();
    expect(s.lastRejection).toBe('not-found');
    expect(s.session.captures).toHaveLength(0);
  });

  it('a mid-session resolution change is rejected, not mixed in', () => {
    useCameraWizardStore.getState().addCaptureFrame(boardFrame());
    useCameraWizardStore.getState().addCaptureFrame(blankFrame(160, 120));
    const s = useCameraWizardStore.getState();
    expect(s.lastRejection).toBe('resolution-changed');
    expect(s.session.captures).toHaveLength(1);
  });

  it('solving with too few captures fails typed and clears the flag', () => {
    useCameraWizardStore.getState().addCaptureFrame(boardFrame());
    useCameraWizardStore.getState().beginSolve();
    expect(useCameraWizardStore.getState().solving).toBe(true);
    expect(useCameraWizardStore.getState().step).toBe('review');
    useCameraWizardStore.getState().completeSolve();
    const s = useCameraWizardStore.getState();
    expect(s.solving).toBe(false);
    expect(s.session).toMatchObject({ kind: 'failed', reason: 'too-few-views' });
    expect(s.rectifiedFrame).toBeNull();
  });

  it('setSpec discards captures taken against the old board', () => {
    useCameraWizardStore.getState().addCaptureFrame(boardFrame());
    useCameraWizardStore.getState().setSpec({ rows: 5, cols: 8 });
    expect(useCameraWizardStore.getState().session.captures).toHaveLength(0);
  });

  it('minimize toggles, opening starts expanded, and closing clears it', () => {
    expect(useCameraWizardStore.getState().minimized).toBe(false);
    useCameraWizardStore.getState().toggleMinimized();
    expect(useCameraWizardStore.getState().minimized).toBe(true);
    useCameraWizardStore.getState().closeWizard();
    expect(useCameraWizardStore.getState().minimized).toBe(false);
    useCameraWizardStore.getState().toggleMinimized();
    useCameraWizardStore.getState().openWizard();
    expect(useCameraWizardStore.getState().minimized).toBe(false);
  });
});
