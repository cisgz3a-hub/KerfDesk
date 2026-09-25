// Data Matrix ECC 200 module placement (ISO/IEC 16022 Annex F). Codewords are
// laid into the mapping matrix — the data regions joined, without finder or
// clock modules — as diagonal "utah" shapes, with four special corner shapes
// and a fixed 2x2 pattern when the last corner stays empty.

/** Entry = codeword index * 8 + bit (0 = most significant), or a fixed module. */
export const DATA_MATRIX_FIXED_LIGHT = -1;
export const DATA_MATRIX_FIXED_DARK = -2;
const UNSET = -3;

type Offset = readonly [row: number, column: number];

const UTAH: readonly Offset[] = [
  [-2, -2],
  [-2, -1],
  [-1, -2],
  [-1, -1],
  [-1, 0],
  [0, -2],
  [0, -1],
  [0, 0],
];

type Placement = {
  readonly rows: number;
  readonly columns: number;
  readonly map: Int32Array;
  codeword: number;
};

export function dataMatrixPlacement(rows: number, columns: number): Int32Array {
  const state: Placement = {
    rows,
    columns,
    map: new Int32Array(rows * columns).fill(UNSET),
    codeword: 0,
  };
  let row = 4;
  let column = 0;
  do {
    const corner = cornerShape(row, column, rows, columns);
    if (corner !== null) place(state, corner);
    [row, column] = sweepUpRight(state, row, column);
    [row, column] = sweepDownLeft(state, row + 1, column + 3);
    row += 3;
    column += 1;
  } while (row < rows || column < columns);
  fillFixedCorner(state.map, rows, columns);
  return state.map;
}

function place(state: Placement, cells: readonly Offset[]): void {
  cells.forEach(([row, column], bit) => {
    const [r, c] = wrap(row, column, state.rows, state.columns);
    state.map[r * state.columns + c] = state.codeword * 8 + bit;
  });
  state.codeword += 1;
}

function isUnset(state: Placement, row: number, column: number): boolean {
  return state.map[row * state.columns + column] === UNSET;
}

/** Places utah shapes up and to the right; returns where the sweep stopped. */
function sweepUpRight(state: Placement, startRow: number, startColumn: number): [number, number] {
  let row = startRow;
  let column = startColumn;
  do {
    if (row < state.rows && column >= 0 && isUnset(state, row, column)) {
      place(state, utah(row, column));
    }
    row -= 2;
    column += 2;
  } while (row >= 0 && column < state.columns);
  return [row, column];
}

/** Places utah shapes down and to the left; returns where the sweep stopped. */
function sweepDownLeft(state: Placement, startRow: number, startColumn: number): [number, number] {
  let row = startRow;
  let column = startColumn;
  do {
    if (row >= 0 && column < state.columns && isUnset(state, row, column)) {
      place(state, utah(row, column));
    }
    row += 2;
    column -= 2;
  } while (row < state.rows && column >= 0);
  return [row, column];
}

function utah(row: number, column: number): Offset[] {
  return UTAH.map(([dr, dc]) => [row + dr, column + dc] as const);
}

// Shapes that wrap around the matrix edges start at fixed sweep positions.
function cornerShape(row: number, column: number, rows: number, columns: number): Offset[] | null {
  const last = rows - 1;
  const right = columns - 1;
  if (row === rows && column === 0) {
    return [
      [last, 0],
      [last, 1],
      [last, 2],
      [0, right - 1],
      [0, right],
      [1, right],
      [2, right],
      [3, right],
    ];
  }
  if (row === rows - 2 && column === 0 && columns % 4 !== 0) {
    return [
      [last - 2, 0],
      [last - 1, 0],
      [last, 0],
      [0, right - 3],
      [0, right - 2],
      [0, right - 1],
      [0, right],
      [1, right],
    ];
  }
  if (row === rows - 2 && column === 0 && columns % 8 === 4) {
    return [
      [last - 2, 0],
      [last - 1, 0],
      [last, 0],
      [0, right - 1],
      [0, right],
      [1, right],
      [2, right],
      [3, right],
    ];
  }
  if (row === rows + 4 && column === 2 && columns % 8 === 0) {
    return [
      [last, 0],
      [last, right],
      [0, right - 2],
      [0, right - 1],
      [0, right],
      [1, right - 2],
      [1, right - 1],
      [1, right],
    ];
  }
  return null;
}

// Utah modules that fall off the top or left edge continue on the opposite edge.
function wrap(
  row: number,
  column: number,
  rows: number,
  columns: number,
): readonly [number, number] {
  let r = row;
  let c = column;
  if (r < 0) {
    r += rows;
    c += 4 - ((rows + 4) % 8);
  }
  if (c < 0) {
    c += columns;
    r += 4 - ((columns + 4) % 8);
  }
  return [r, c];
}

function fillFixedCorner(map: Int32Array, rows: number, columns: number): void {
  const bottomRight = rows * columns - 1;
  if (map[bottomRight] !== UNSET) return;
  map[bottomRight] = DATA_MATRIX_FIXED_DARK;
  map[bottomRight - 1] = DATA_MATRIX_FIXED_LIGHT;
  map[bottomRight - columns] = DATA_MATRIX_FIXED_LIGHT;
  map[bottomRight - columns - 1] = DATA_MATRIX_FIXED_DARK;
}
