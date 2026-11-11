import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

// ADR-127 Amendment 2 composed with ADR-694: on a tapered tumbler (Ø80 at the
// rim, Ø70 at the base over 100 mm, Creality chuck at 40 machine mm per turn)
// a stroke round the part must move its surface at the layer speed at both
// ends, so both ends get the same dose. The program is replayed onto the cone
// with no help from the emitter's maths: machine Y is an angle
// (2π per 40 mm), and the surface it sweeps is that angle times the cone's
// radius under the stroke's X.

const LAYER_SPEED = 1500;
const MM_PER_TURN = 40;
const TAPERED: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: MM_PER_TURN,
  objectDiameterMm: 80,
  taper: {
    enabled: true,
    topDiameterMm: 80,
    bottomDiameterMm: 70,
    lengthMm: 100,
    topSide: 'left',
    artworkFromTopMm: 0,
  },
};

/** Distance down the side from the rim → the cone's radius. */
function coneRadiusAt(fromRim: number): number {
  return 40 - (5 * fromRim) / 100;
}

/** Two strokes round the part, one at the rim (X 0) and one at the base (X 100). */
function project(): Project {
  const line = (x: number) => ({
    points: [
      { x, y: 20 },
      { x, y: 40 },
    ],
    closed: false,
  });
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 20, maxX: 100, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [line(0), line(100)] }],
  };
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: TAPERED });
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), speed: LAYER_SPEED };
  return { ...base, scene: addLayer(addObject(base.scene, object), layer) };
}

type Stroke = { readonly x: number; readonly dy: number; readonly feed: number };

/** Every lit G1 that turns the part, with its modal feed. */
type Modal = { x: number; y: number; feed: number; power: number; motion: string };

const MODAL_WORDS: Readonly<Record<string, 'x' | 'y' | 'feed' | 'power'>> = {
  X: 'x',
  Y: 'y',
  F: 'feed',
  S: 'power',
};

function applyWords(line: string, state: Modal): void {
  for (const word of line.replace(/;.*$/, '').match(/[A-Z]-?\d*\.?\d+/g) ?? []) {
    const value = Number(word.slice(1));
    if (word[0] === 'G' && (value === 0 || value === 1)) state.motion = `G${value}`;
    const key = MODAL_WORDS[word[0] ?? ''];
    if (key !== undefined) state[key] = value;
  }
}

function strokesRoundThePart(gcode: string): Stroke[] {
  const strokes: Stroke[] = [];
  const state: Modal = { x: 0, y: 0, feed: Number.NaN, power: 0, motion: 'G0' };
  for (const raw of gcode.split('\n')) {
    const before = { x: state.x, y: state.y };
    applyWords(raw, state);
    const dy = state.y - before.y;
    if (state.motion === 'G1' && state.power > 0 && dy !== 0 && state.x === before.x) {
      strokes.push({ x: state.x, dy, feed: state.feed });
    }
  }
  return strokes;
}

describe('a tapered part burns evenly round both ends (ADR-127 Amd 2 with ADR-694)', () => {
  it('moves the surface at the layer speed at the rim and at the base', () => {
    const result = emitGcode(project());
    expect(result.preflight.ok).toBe(true);
    const strokes = strokesRoundThePart(result.gcode);
    const rimX = Math.min(...strokes.map((s) => s.x));
    const ends = new Map<number, number>();
    for (const stroke of strokes) {
      const fromRim = stroke.x - rimX;
      const angle = (2 * Math.PI * Math.abs(stroke.dy)) / MM_PER_TURN;
      const surfaceMm = angle * coneRadiusAt(fromRim);
      const minutes = Math.abs(stroke.dy) / stroke.feed;
      const speed = surfaceMm / minutes;
      expect(speed / LAYER_SPEED).toBeGreaterThan(0.99);
      expect(speed / LAYER_SPEED).toBeLessThan(1.01);
      ends.set(Math.round(fromRim), stroke.feed);
    }
    // Both ends burned, each at its own feed: the base turns farther per surface mm.
    expect([...ends.keys()].sort((a, b) => a - b)).toEqual([0, 100]);
    expect(ends.get(100)).toBeGreaterThan(ends.get(0) ?? Number.POSITIVE_INFINITY);
  });
});
