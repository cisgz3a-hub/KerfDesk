import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { canvasTextInputStyle } from './canvas-text-layout';
import { canvasTextPanelPosition } from './canvas-text-panel-position';
import { useCanvasTextStore } from './canvas-text-store';
import type { DialogValues } from './use-text-dialog-fields';

const values: DialogValues = {
  content: 'A',
  fontKey: 'roboto-regular',
  sizeMm: 10,
  alignment: 'left',
  lineHeight: 1.4,
  letterSpacing: 0,
  bendDeg: 0,
  color: '#000000',
  embeddedFonts: [],
};

describe('canvas text input placement', () => {
  it('normalizes leading blank lines to the same visible ink origin as vector text', () => {
    useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 });
    const session = useCanvasTextStore.getState().session;
    if (session === null) throw new Error('Missing session');
    const view = { scale: 2, offsetX: 24, offsetY: 24 };
    const plain = canvasTextInputStyle(session, values, null, view).style;
    const blank = canvasTextInputStyle(session, { ...values, content: '\nA' }, null, view).style;
    expect(Number(blank.top) + 28).toBeCloseTo(Number(plain.top));
    expect(Number(blank.height)).toBeCloseTo(Number(plain.height) + 14);
    useCanvasTextStore.getState().close();
  });

  it('keeps the native input on the rotated and mirrored object axes', () => {
    useCanvasTextStore.getState().beginAdd({ x: 30, y: 40 });
    const session = useCanvasTextStore.getState().session;
    if (session === null) throw new Error('Missing session');
    const object = {
      kind: 'text' as const,
      id: 'text',
      ...values,
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 7 },
      paths: [],
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 80,
        y: 60,
        scaleX: 2,
        scaleY: 3,
        mirrorX: true,
        rotationDeg: 90,
      },
    };
    const style = canvasTextInputStyle(session, values, object, {
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    }).style;
    const matrix = String(style.transform).slice(7, -1).split(',').map(Number);
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[1]).toBeCloseTo(-4);
    expect(matrix[2]).toBeCloseTo(-6);
    expect(matrix[3]).toBeCloseTo(0);
    useCanvasTextStore.getState().close();
  });
});

describe('canvas text panel placement', () => {
  it('docks below lettering when the side rails leave no horizontal space', () => {
    const panel = canvasTextPanelPosition(
      { left: 180, top: 220, width: 180, height: 48 },
      { width: 600, height: 750 },
    );
    expect(Number(panel.top)).toBeGreaterThan(268);
    expect(Number(panel.top) + Number(panel.maxHeight)).toBeLessThan(750);
  });

  it('uses transformed input extents when deciding whether a side panel would overlap', () => {
    const panel = canvasTextPanelPosition(
      { left: 100, top: 100, width: 200, height: 30, transform: 'matrix(3,0,0,2,0,0)' },
      { width: 900, height: 750 },
    );
    expect(Number(panel.top)).toBeGreaterThan(160);
  });
});
