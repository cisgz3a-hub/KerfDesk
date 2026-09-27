import { describe, expect, it } from 'vitest';
import { overheadPose, wideLens } from '../../../core/camera/model/model-fixtures';
import {
  PLYWOOD,
  renderCameraPicture,
  type RenderedPiece,
} from '../../../core/camera/pieces/piece-render-fixtures';
import { PIECE_PIXELS_PER_MM, piecePixelsPerMm, scanBedPieces } from './scan-bed-pieces';

describe('piecePixelsPerMm', () => {
  it('keeps 2 px/mm on ordinary beds and coarsens only very large ones', () => {
    expect(piecePixelsPerMm(400, 400)).toBe(PIECE_PIXELS_PER_MM);
    expect(piecePixelsPerMm(1300, 900)).toBeCloseTo(Math.sqrt(2_000_000 / (1300 * 900)));
  });
});

describe('scanBedPieces', () => {
  const lens = wideLens();
  const pose = overheadPose();
  const blank = (x: number, y: number, angleDeg: number, topMm?: number): RenderedPiece => ({
    kind: 'rect',
    centre: { x, y },
    length: 80,
    width: 50,
    angleDeg,
    colour: PLYWOOD,
    ...(topMm === undefined ? {} : { topMm }),
  });
  // One blank on the 3 mm sheet, one lying on top of a 40 mm box.
  const raw = renderCameraPicture({
    lens,
    pose,
    thicknessMm: 3,
    pieces: [blank(120, 150, 20), blank(280, 280, -35, 40)],
  });
  const scan = (heightAreas: Parameters<typeof scanBedPieces>[0]['heightAreas']) =>
    scanBedPieces({
      raw,
      lens,
      pose,
      bedWidthMm: 400,
      bedHeightMm: 400,
      surfaceHeightMm: 3,
      heightAreas,
      reference: { x: 120, y: 150 },
    }) ?? [];
  const offBy = (found: ReturnType<typeof scan>[number] | undefined, x: number, y: number) =>
    Math.hypot((found?.rect.centre.x ?? 0) - x, (found?.rect.centre.y ?? 0) - y);

  // The area reaches past the box on the far side, where the camera sees the
  // raised blank in front of the bed behind it.
  it('finds each blank where it really is, at its own height', { timeout: 30_000 }, () => {
    const pieces = scan([
      { id: 'box', x: 200, y: 200, width: 190, height: 190, surfaceHeightMm: 40 },
    ]);
    expect(pieces).toHaveLength(2);
    expect(offBy(pieces[0], 120, 150)).toBeLessThan(0.8);
    expect(Math.abs((pieces[0]?.rect.axisDeg ?? 0) - 20)).toBeLessThan(1);
    expect(offBy(pieces[1], 280, 280)).toBeLessThan(0.8);
    expect(Math.abs((pieces[1]?.rect.axisDeg ?? 0) - 145)).toBeLessThan(1);
  });

  it(
    'puts the raised blank several millimetres off without its height area',
    { timeout: 30_000 },
    () => {
      const pieces = scan([]);
      expect(offBy(pieces[1], 280, 280)).toBeGreaterThan(3);
    },
  );
});
