import type { Vec2 } from '../../core/scene';
import {
  finitePoint,
  HpglError,
  PLOTTER_MAPPING,
  requireArgs,
  type HpglMapping,
  type HpglScaling,
  type HpglState,
} from './hpgl-types';

export function setInputPoints(state: HpglState): void {
  const { command } = state;
  requireArgs(command, [0, 2, 4]);
  const [x = 0, y = 0, x2, y2] = command.values;
  if (command.values.length === 0) {
    state.p1 = null;
    state.p2 = null;
  } else {
    const previous = state.p1;
    state.p1 = { x, y };
    state.p2 =
      x2 !== undefined && y2 !== undefined
        ? { x: x2, y: y2 }
        : previous !== null && state.p2 !== null
          ? finitePoint({ x: state.p2.x + x - previous.x, y: state.p2.y + y - previous.y }, command)
          : null;
  }
  state.mapping = resolveMapping(state);
}

export function setScaling(state: HpglState): void {
  requireArgs(state.command, [0, 4, 5, 7]);
  state.scaling = readScaling(state);
  state.mapping = resolveMapping(state);
}

function readScaling(state: HpglState): HpglScaling | null {
  const values = state.command.values;
  if (values.length === 0) return null;
  const type = values[4] ?? 0;
  if (![0, 1, 2].includes(type) || (values.length === 7 && type !== 1)) {
    throw new HpglError(
      'invalid-parameters',
      'SC supports types 0, 1 and 2; left/bottom belong to type 1.',
      state.command,
    );
  }
  const [xmin = 0, xmax = 0, ymin = 0, ymax = 0] = values;
  return { xmin, xmax, ymin, ymax, type, left: values[5] ?? 50, bottom: values[6] ?? 50 };
}

function resolveMapping(state: HpglState): HpglMapping {
  const scale = state.scaling;
  if (scale === null) return PLOTTER_MAPPING;
  if (state.p1 === null) {
    throw new HpglError(
      'missing-scale-reference',
      'SC requires explicit IP reference points; the file does not define a physical page size.',
      state.command,
    );
  }
  const { xmin, xmax, ymin, ymax, type } = scale;
  if (type === 2)
    return checkedMapping(
      { sx: xmax, sy: ymax, tx: state.p1.x - xmin * xmax, ty: state.p1.y - ymin * ymax },
      state,
    );
  const p2 = state.p2;
  if (p2 === null)
    throw new HpglError(
      'missing-scale-reference',
      'Specify both IP reference points.',
      state.command,
    );
  return rangeMapping(state, scale, state.p1, p2);
}

function rangeMapping(state: HpglState, scale: HpglScaling, p1: Vec2, p2: Vec2): HpglMapping {
  const { xmin, xmax, ymin, ymax, type, left, bottom } = scale;
  if (xmin === xmax || ymin === ymax)
    throw new HpglError('invalid-parameters', 'SC ranges must have nonzero spans.', state.command);
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let sx = dx / (xmax - xmin);
  let sy = dy / (ymax - ymin);
  let tx = p1.x - sx * xmin;
  let ty = p1.y - sy * ymin;
  if (type === 1) {
    if (left < 0 || left > 100 || bottom < 0 || bottom > 100)
      throw new HpglError(
        'invalid-parameters',
        'SC left/bottom percentages must be between 0 and 100.',
        state.command,
      );
    const magnitude = Math.min(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx) * magnitude;
    sy = Math.sign(sy) * magnitude;
    tx = p1.x + ((dx - sx * (xmax - xmin)) * left) / 100 - sx * xmin;
    ty = p1.y + ((dy - sy * (ymax - ymin)) * bottom) / 100 - sy * ymin;
  }
  return checkedMapping({ sx, sy, tx, ty }, state);
}

function checkedMapping(mapping: HpglMapping, state: HpglState): HpglMapping {
  if (!Object.values(mapping).every(Number.isFinite) || mapping.sx === 0 || mapping.sy === 0) {
    throw new HpglError(
      'invalid-geometry',
      'Scaling must define finite, nonzero coordinate axes.',
      state.command,
    );
  }
  return mapping;
}

export function userPoint(state: HpglState): Vec2 {
  const { sx, sy, tx, ty } = state.mapping;
  return finitePoint(
    { x: (state.position.x - tx) / sx, y: (state.position.y - ty) / sy },
    state.command,
  );
}

export function plotterPoint(state: HpglState, point: Vec2): Vec2 {
  const { sx, sy, tx, ty } = state.mapping;
  return finitePoint({ x: point.x * sx + tx, y: point.y * sy + ty }, state.command);
}
