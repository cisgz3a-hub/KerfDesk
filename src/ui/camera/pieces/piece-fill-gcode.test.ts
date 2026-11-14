// Find pieces and Place, through to the emitted G-code (ADR-442 Amendment 2,
// camera audit v2 K3): every cutting move of every copy must land on a real
// blank, on a bed with an L-shaped offcut, a blank too small for the design,
// two blanks pushed flush together and a reflection on the honeycomb.
// Synthetic top-down picture; no camera.

import { describe, expect, it } from 'vitest';
import { toSceneCoords } from '../../../core/devices/origin-transform';
import { findPieces, MIN_PIECE_AREA_MM2 } from '../../../core/camera/pieces/find-pieces';
import { piecesTheDesignFits } from '../../../core/camera/pieces/piece-fit';
import { pieceUnder, piecePlacements } from '../../../core/camera/pieces/piece-placements';
import {
  onRenderedPiece,
  PLYWOOD,
  renderBedPicture,
  type RenderedPiece,
} from '../../../core/camera/pieces/piece-render-fixtures';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../../core/scene';
import { emitGcode } from '../../../io/gcode';
import { placedObject } from '../../state/array-selection-copies';
import { designFrame } from '../../../core/camera/pieces/design-frame';

const REGION = { x: 0, y: 0, width: 300, height: 220 };
const PPM = 2;
const COLOR = '#ff0000';

function blank(x: number, y: number, length: number, width: number): RenderedPiece {
  return { kind: 'rect', centre: { x, y }, length, width, angleDeg: 0, colour: PLYWOOD };
}

const L_OFFCUT: RenderedPiece = {
  kind: 'polygon',
  points: [
    { x: 160, y: 110 },
    { x: 280, y: 110 },
    { x: 280, y: 150 },
    { x: 200, y: 150 },
    { x: 200, y: 210 },
    { x: 160, y: 210 },
  ],
  colour: PLYWOOD,
};
const BLANKS: RenderedPiece[] = [
  blank(40, 40, 60, 40),
  blank(120, 40, 60, 40),
  blank(200, 40, 60, 40),
  // Two blanks pushed flush together: one 120 × 40 "piece".
  blank(40, 120, 60, 40),
  blank(100, 120, 60, 40),
  // Too small for a 36 × 24 design.
  blank(60, 185, 30, 30),
  L_OFFCUT,
];
const GLARE = { x: 120, y: 185, peak: 110, sigma: 8 };

// The design: a 36 × 24 mm rectangle cut on the bed, off every blank.
function designObject(): SceneObject {
  const points = [
    { x: -18, y: -12 },
    { x: 18, y: -12 },
    { x: 18, y: 12 },
    { x: -18, y: 12 },
  ];
  return {
    kind: 'imported-svg',
    id: 'design',
    source: 'design.svg',
    transform: { ...IDENTITY_TRANSFORM, x: 270, y: 200 },
    bounds: { minX: -18, minY: -12, maxX: 18, maxY: 12 },
    paths: [{ color: COLOR, polylines: [{ points, closed: true }] }],
  } as SceneObject;
}

function cuttingPoints(project: Project): Array<{ x: number; y: number }> {
  const { gcode } = emitGcode(project);
  const points: Array<{ x: number; y: number }> = [];
  let x = 0;
  let y = 0;
  for (const line of gcode.split('\n')) {
    const mx = /X(-?[\d.]+)/.exec(line);
    const my = /Y(-?[\d.]+)/.exec(line);
    if (mx !== null) x = Number(mx[1]);
    if (my !== null) y = Number(my[1]);
    if (/^G1\b/.test(line) && (mx !== null || my !== null)) {
      points.push(toSceneCoords({ x, y }, project.device));
    }
  }
  return points;
}

function onABlank(point: { x: number; y: number }): boolean {
  // Within 0.3 mm of a blank: the outline is measured, not drawn.
  const offsets = [-0.3, 0, 0.3];
  return BLANKS.some((piece) =>
    offsets.some((dx) => offsets.some((dy) => onRenderedPiece(piece, point.x + dx, point.y + dy))),
  );
}

describe('Place selection on each piece, emitted', () => {
  it('cuts every copy on a real blank, and none on the bed', { timeout: 90_000 }, () => {
    const image = renderBedPicture({
      region: REGION,
      pixelsPerMm: PPM,
      pieces: BLANKS,
      noise: 2,
      light: (x, y) =>
        GLARE.peak * Math.exp(-((x - GLARE.x) ** 2 + (y - GLARE.y) ** 2) / (2 * GLARE.sigma ** 2)),
    });
    const design = designObject();
    const frame = designFrame([design]);
    if (frame === null) throw new Error('no design frame');
    const pieces = findPieces({
      image,
      region: REGION,
      pixelsPerMm: PPM,
      reference: frame.centre,
      minAreaMm2: MIN_PIECE_AREA_MM2,
    });
    const near = (x: number, y: number) =>
      pieces.find((piece) => Math.hypot(piece.rect.centre.x - x, piece.rect.centre.y - y) < 15);
    // The flush pair and the L are far larger than the batch's blanks, so they
    // start left out; nothing is found at the reflection unless doubted.
    expect(near(70, 120)?.doubt).toBe('larger');
    const lPiece = pieces.find((piece) =>
      onRenderedPiece(L_OFFCUT, piece.centroid.x, piece.centroid.y),
    );
    expect(lPiece?.doubt).toBe('larger');
    const glare = near(GLARE.x, GLARE.y);
    expect(glare === undefined || glare.doubt !== undefined).toBe(true);
    // As the panel starts them, with the operator ticking the L back in.
    const ticked = pieces.filter(
      (piece) => piece === lPiece || (!piece.partial && piece.doubt === undefined),
    );
    const sample = pieceUnder(pieces, frame.centre);
    const { fitting, runsOff } = piecesTheDesignFits(ticked, frame, sample);
    // The three blanks and the L fit; the small blank does not.
    expect(fitting).toHaveLength(4);
    expect(runsOff).toHaveLength(1);
    const copies = piecePlacements({ pieces: fitting, design: frame, sample }).map(
      (placement, index) => ({ ...placedObject(design, placement), id: `copy-${index}` }),
    );
    const base = createProject();
    const project: Project = {
      ...base,
      jobSetup: {
        ...base.jobSetup,
        placement: { ...base.jobSetup.placement, startFrom: 'absolute' },
      },
      scene: {
        ...base.scene,
        layers: [{ ...createLayer({ id: 'cut', color: COLOR }), power: 50 }],
        objects: copies,
      },
    };
    const points = cuttingPoints(project);
    expect(points.length).toBeGreaterThan(fitting.length * 4 - 1);
    const off = points.filter((point) => !onABlank(point));
    expect(off).toEqual([]);
  });
});
