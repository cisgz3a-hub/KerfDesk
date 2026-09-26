import { describe, expect, it } from 'vitest';
import { fieldConfirmsWedge, wedgeFieldFit, type WedgeLine } from './contour-corner-field';
import type { CrackSubPixelField } from './saddle-connectivity';

// A 40 degree ink wedge pointing left, apex at (10.3, 20.4): the incoming leg
// runs up-left along the lower edge to the apex, the outgoing leg up-right
// along the upper edge (ink on the right of travel).
const APEX = { x: 10.3, y: 20.4 };
const HALF = (20 * Math.PI) / 180;
const back: WedgeLine = {
  cx: APEX.x + 10 * Math.cos(HALF),
  cy: APEX.y + 10 * Math.sin(HALF),
  dx: -Math.cos(HALF),
  dy: -Math.sin(HALF),
};
const ahead: WedgeLine = {
  cx: APEX.x + 10 * Math.cos(HALF),
  cy: APEX.y - 10 * Math.sin(HALF),
  dx: Math.cos(HALF),
  dy: -Math.sin(HALF),
};

function boxFiltered(inside: (x: number, y: number) => boolean): CrackSubPixelField {
  const samples = 16;
  return {
    lumaAt: (px, py) => {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          if (inside(px + (sx + 0.5) / samples, py + (sy + 0.5) / samples)) covered += 1;
        }
      }
      return 255 - (covered / samples ** 2) * 255;
    },
    thresholdAt: () => 128,
  };
}

const inWedge = (x: number, y: number): boolean =>
  x > APEX.x && Math.abs(y - APEX.y) < (x - APEX.x) * Math.tan(HALF);

describe('wedgeFieldFit', () => {
  it('confirms the apex of an anti-aliased wedge', () => {
    const fit = wedgeFieldFit(boxFiltered(inWedge), APEX, back, ahead, 1);
    expect(fit).not.toBeNull();
    expect(fit?.max).toBeLessThan(0.05);
    expect(fieldConfirmsWedge(fit)).toBe(true);
  });

  it('rejects legs that only extrapolate to a meeting point round a rounded tip', () => {
    // The same legs, but the tip is rounded off by a 3 px fillet.
    const r = 3;
    const centreX = APEX.x + r / Math.sin(HALF);
    // Past the fillet's tangent points the wedge is whole; before them only
    // the fillet circle is ink.
    const tangentX = (r * Math.cos(HALF) ** 2) / Math.sin(HALF);
    const rounded = (x: number, y: number): boolean =>
      inWedge(x, y) && (x - APEX.x >= tangentX || Math.hypot(x - centreX, y - APEX.y) < r);
    const fit = wedgeFieldFit(boxFiltered(rounded), APEX, back, ahead, 1);
    expect(fit).not.toBeNull();
    expect(fieldConfirmsWedge(fit)).toBe(false);
  });

  it('confirms the concave corner of a paper wedge cut into ink', () => {
    // Reversed travel keeps ink on the right: the wedge is now paper.
    const reverse = (l: WedgeLine): WedgeLine => ({ ...l, dx: -l.dx, dy: -l.dy });
    const notch = boxFiltered((x, y) => !inWedge(x, y));
    const fit = wedgeFieldFit(notch, APEX, reverse(ahead), reverse(back), 1);
    expect(fit?.max).toBeLessThan(0.05);
    expect(fieldConfirmsWedge(fit)).toBe(true);
  });

  it('confirms the apex on a 2x bilinear enlargement of the anti-aliased wedge', () => {
    // auto-upscale.ts upscaleBy: each enlarged pixel samples the source's
    // pixel centres bilinearly at ((o + 0.5) / 2 - 0.5).
    const source = boxFiltered(inWedge);
    const enlarged: CrackSubPixelField = {
      lumaAt: (ox, oy) => {
        const sx = (ox + 0.5) / 2 - 0.5;
        const sy = (oy + 0.5) / 2 - 0.5;
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;
        const row = (y: number): number =>
          source.lumaAt(x0, y) * (1 - fx) + source.lumaAt(x0 + 1, y) * fx;
        return Math.round(row(y0) * (1 - fy) + row(y0 + 1) * fy);
      },
      thresholdAt: () => 128,
    };
    const double = (l: WedgeLine): WedgeLine => ({ ...l, cx: l.cx * 2, cy: l.cy * 2 });
    const fit = wedgeFieldFit(
      enlarged,
      { x: APEX.x * 2, y: APEX.y * 2 },
      double(back),
      double(ahead),
      2,
    );
    expect(fit?.max).toBeLessThan(0.05);
    expect(fieldConfirmsWedge(fit)).toBe(true);
  });

  it('confirms legs on an iso-line off half coverage (an Otsu threshold)', () => {
    // Otsu at 97 of 255 puts the iso-line ~0.12 px inside the ink; the legs
    // run parallel to the drawn edges, 0.15 px in, and meet further in.
    const inset = 0.15;
    const moveIn = (l: WedgeLine): WedgeLine => ({
      ...l,
      cx: l.cx - l.dy * inset,
      cy: l.cy + l.dx * inset,
    });
    const apex = { x: APEX.x + inset / Math.sin(HALF), y: APEX.y };
    const fit = wedgeFieldFit(boxFiltered(inWedge), apex, moveIn(back), moveIn(ahead), 1);
    expect(fit?.max).toBeLessThan(0.1);
    expect(fieldConfirmsWedge(fit)).toBe(true);
  });

  it('cannot judge a field without paper-to-ink contrast', () => {
    const flat: CrackSubPixelField = { lumaAt: () => 128, thresholdAt: () => 128 };
    expect(wedgeFieldFit(flat, APEX, back, ahead, 1)).toBeNull();
  });
});
